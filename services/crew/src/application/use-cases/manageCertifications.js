const {
  CERTIFICATION_STATUSES,
  isValidCrewUserId,
  positionInfo,
  certificationStatus,
  validateCertificationInput,
  historyEventsFor,
  parseListParams,
  matchesSearch,
  compareForList,
  certificationOptions,
} = require('../../domain/entities/certification');
const { parseCertificateFile } = require('../../domain/value-objects/certificateFile');
const { DomainError } = require('../../domain/errors');

// Admin acepta hasta 200 ids por consulta.
const LOOKUP_BATCH_SIZE = 200;

function crewNotFound() {
  return new DomainError('Tripulante no encontrado.', 404);
}

// Certificaciones de la tripulación, solo para el super_admin: registrar, editar,
// verificar o quitar la verificación, eliminar y consultar. El nombre y el correo
// vienen de Admin; si no responde, quedan en null y la respuesta sale igual.
// notifyCertification avisa al tripulante al registrarla y al verificarla; es un
// extra: si Notification falla, la certificación queda guardada igual.
function createManageCertifications({
  certificationRepository,
  findUsersByIds,
  notifyCertification = async () => {},
}) {
  async function loadUsers(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    const batches = [];

    for (let start = 0; start < unique.length; start += LOOKUP_BATCH_SIZE) {
      batches.push(unique.slice(start, start + LOOKUP_BATCH_SIZE));
    }

    try {
      const results = await Promise.all(batches.map((batch) => findUsersByIds(batch)));
      return new Map(results.flat().map((user) => [user.id, user]));
    } catch (error) {
      console.error(`No se pudieron cargar los usuarios desde Admin: ${error.message}`);
      return new Map();
    }
  }

  // Fila de la tabla: tripulante y su certificación.
  function toItem({ member, certification }, users) {
    const user = users.get(member.user_id);
    const info = positionInfo(member.position);

    return {
      user_id: member.user_id,
      employee_code: member.employee_code,
      name: user ? user.name : null,
      email: user ? user.email : null,
      position: member.position,
      area: info ? info.area : null,
      base: member.base,
      license_number: certification ? certification.license_number : null,
      certificates: certification ? certification.certificates : [],
      status: certificationStatus(certification),
      updated_at: certification ? certification.updated_at : null,
    };
  }

  // Ficha: la fila, la copia (sin bytes) y el historial con el nombre de quién lo hizo.
  async function toDetail(record) {
    const history = record.certification
      ? await certificationRepository.findHistory(record.member.user_id)
      : [];
    const users = await loadUsers([
      record.member.user_id,
      ...history.map((entry) => entry.actor_user_id),
    ]);

    return {
      ...toItem(record, users),
      file: record.certification ? record.certification.file : null,
      history: history.map((entry) => {
        const actor = users.get(entry.actor_user_id);
        return {
          event: entry.event,
          by_user_id: entry.actor_user_id,
          by: actor ? actor.name : null,
          note: entry.note,
          created_at: entry.created_at,
        };
      }),
    };
  }

  async function findRecord(crewUserId) {
    const record = isValidCrewUserId(crewUserId)
      ? await certificationRepository.findCrewCertification(crewUserId)
      : null;

    if (!record) {
      throw crewNotFound();
    }

    return record;
  }

  async function loadItems() {
    const records = await certificationRepository.findActiveCrewCertifications();
    const users = await loadUsers(records.map(({ member }) => member.user_id));
    return records.map((record) => toItem(record, users));
  }

  // Tabla: búsqueda (nombre, ID o licencia), filtro por estado y página.
  async function listCertifications(query) {
    const { page, pageSize, search, status } = parseListParams(query);
    const matches = (await loadItems())
      .filter((item) => (!status || item.status === status) && matchesSearch(item, search))
      .sort(compareForList);
    const start = (page - 1) * pageSize;

    return {
      items: matches.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total: matches.length,
    };
  }

  // Indicadores y conteos de los filtros.
  async function getCertificationStats() {
    const records = await certificationRepository.findActiveCrewCertifications();
    const byStatus = Object.fromEntries(CERTIFICATION_STATUSES.map((status) => [status, 0]));

    for (const { certification } of records) {
      byStatus[certificationStatus(certification)] += 1;
    }

    return { total: records.length, by_status: byStatus };
  }

  // Opciones de «Tripulante» en «Registrar certificado»: los que no tienen.
  async function listUncertifiedCrew() {
    return (await loadItems())
      .filter((item) => item.status === 'uncertified')
      .sort(compareForList);
  }

  async function getCertification(crewUserId) {
    return toDetail(await findRecord(crewUserId));
  }

  // Registra o edita (PUT). verified decide «Verificado» o «Por verificar».
  // file: undefined deja la copia que había, null la quita y un objeto la reemplaza.
  async function saveCertification(actor, crewUserId, input) {
    const record = await findRecord(crewUserId);

    if (!record.member.is_active) {
      throw new DomainError('El tripulante está desactivado: no se puede registrar su certificación.', 409);
    }

    const next = validateCertificationInput(record.member.position, input);
    const { file } = input || {};
    const parsedFile = file === undefined || file === null ? file : parseCertificateFile(file);
    const userId = record.member.user_id;

    // La certificación que había antes del cambio (null si es nueva).
    const before = await certificationRepository.withCertificationLock(userId, async (tx) => {
      const previous = await tx.findCertification(userId);

      await tx.upsertCertification({
        crewUserId: userId,
        licenseNumber: next.licenseNumber,
        certificates: next.certificates,
        status: next.status,
      });

      if (parsedFile === null) {
        await tx.deleteFile(userId);
      } else if (parsedFile) {
        await tx.replaceFile({ crewUserId: userId, ...parsedFile });
      }

      await tx.insertEvents(userId, actor.id, historyEventsFor(previous, next, next.area));
      return previous;
    });

    const detail = await getCertification(userId);
    const event = !before
      ? 'registered'
      : next.status === 'verified' && before.status !== 'verified'
        ? 'verified'
        : null;

    if (event) {
      // No se espera: el super_admin recibe su respuesta aunque Notification tarde.
      notifyCertification({
        crewUserId: userId,
        event,
        actorName: detail.history[0] ? detail.history[0].by : null,
        licenseNumber: next.licenseNumber,
        certificates: next.certificates,
      }).catch((error) =>
        console.error(`No se pudo enviar el aviso de certificación: ${error.message}`)
      );
    }

    return detail;
  }

  // El tripulante queda «sin certificado»: sin licencia, certificados, copia ni historial.
  async function deleteCertification(crewUserId) {
    const record = await findRecord(crewUserId);
    const deleted = await certificationRepository.deleteCertification(record.member.user_id);

    if (!deleted) {
      throw new DomainError('El tripulante no tiene una certificación registrada.', 404);
    }
  }

  async function getCertificationFile(crewUserId) {
    const record = await findRecord(crewUserId);
    const file = record.certification
      ? await certificationRepository.findFile(record.member.user_id)
      : null;

    if (!file) {
      throw new DomainError('La certificación no tiene una copia del certificado.', 404);
    }

    return file;
  }

  return {
    getOptions: certificationOptions,
    listCertifications,
    getCertificationStats,
    listUncertifiedCrew,
    getCertification,
    saveCertification,
    deleteCertification,
    getCertificationFile,
  };
}

module.exports = createManageCertifications;
