const { isValidAbsenceId } = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const NAME_FIELDS = {
  crew_user_id: 'crew_name',
  replacement_user_id: 'replacement_name',
  approved_by: 'approved_by_name',
};

// Fecha de hoy en Colombia (AAAA-MM-DD).
function todayInBogota(now = new Date()) {
  return new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Orden del seguimiento del turno:
// 1. Por aprobar: primero las que no tienen candidatos, luego por salida más
//    próxima, y al final las que la IA todavía está buscando.
// 2. Esperando confirmación: por el plazo que vence primero.
// 3. Cubiertas: la confirmación más reciente primero.
function trackingOrder(a, b) {
  const group = (x) => ({ reported: 0, pending_ack: 1, covered: 2 }[x.status] ?? 3);
  if (group(a) !== group(b)) return group(a) - group(b);

  const time = (value) => (value ? new Date(value).getTime() : 0);
  if (a.status === 'reported') {
    const search = (x) => ({ none: 0, error: 0, ready: 1, searching: 2 }[x.suggestions_state] ?? 1);
    return search(a) - search(b) || time(a.flight_departure_at) - time(b.flight_departure_at);
  }
  if (a.status === 'pending_ack') return time(a.deadline_at) - time(b.deadline_at);
  return time(b.covered_at) - time(a.covered_at);
}

// Flujo de una ausencia después de reportada: aprobación del reemplazo,
// «Enterado», plazo vencido, seguimiento e indicadores.
function createAbsenceWorkflow({ absenceRepository, attachUserNames, notificationClient }) {
  async function nameOf(userId) {
    if (!userId) return null;
    const [named] = await attachUserNames([{ id: userId }], { id: 'name' });
    return named.name;
  }

  // El supervisor confirmó un candidato: queda esperando su «Enterado».
  async function approveReplacement(user, id, input) {
    const { replacement_user_id: replacementUserId, deadline_at: deadlineAt, option } = input || {};

    if (!uuidPattern.test(String(replacementUserId))) {
      throw new DomainError('Se requiere un replacement_user_id válido.', 400, {
        field: 'replacement_user_id',
      });
    }
    const deadline = new Date(deadlineAt);
    if (!deadlineAt || Number.isNaN(deadline.getTime())) {
      throw new DomainError('Se requiere un deadline_at válido.', 400, { field: 'deadline_at' });
    }

    const absence = isValidAbsenceId(id) ? await absenceRepository.findAbsenceById(id) : null;
    if (!absence) throw new DomainError('Ausencia no encontrada.', 404);
    if (absence.crew_user_id === replacementUserId) {
      throw new DomainError('El reemplazo no puede ser el mismo tripulante que se ausentó.');
    }

    const updated = await absenceRepository.markAbsencePendingAck(id, {
      replacementUserId,
      approvedBy: user.role === 'service' ? null : user.id,
      deadlineAt: deadline.toISOString(),
      option: Number.isInteger(option) ? option : null,
    });
    if (!updated) {
      throw new DomainError('La ausencia ya no está esperando reemplazo.', 409, {
        code: 'absence_not_reported',
      });
    }

    const [approver, replacement] = await Promise.all([nameOf(user.id), nameOf(replacementUserId)]);
    await absenceRepository.addAbsenceEvent(
      id,
      'approved',
      `${approver || 'El supervisor'} aprobó a ${replacement || 'un reemplazo'}${
        Number.isInteger(option) ? ` (opción ${option})` : ''
      }`
    );

    return updated;
  }

  // Interno (Flights): el reemplazo dio «Enterado».
  async function acknowledgeAbsence(input) {
    const { flight_id: flightId, replacement_user_id: replacementUserId } = input || {};
    if (!uuidPattern.test(String(flightId)) || !uuidPattern.test(String(replacementUserId))) {
      throw new DomainError('Se requieren flight_id y replacement_user_id válidos.');
    }

    const covered = await absenceRepository.markAcknowledged(flightId, replacementUserId);
    if (!covered) {
      throw new DomainError('No hay una ausencia esperando confirmación de ese tripulante.', 404);
    }

    const replacement = await nameOf(replacementUserId);
    await absenceRepository.addAbsenceEvent(
      covered.id,
      'acknowledged',
      `${replacement || 'El reemplazo'} confirmó con «Enterado»`
    );

    notificationClient.notifyAbsenceCovered({ ...covered, replacement_name: replacement });
    return covered;
  }

  // Interno (Recommendation): el reemplazo dejó vencer el plazo.
  async function markMissed(id) {
    const absence = isValidAbsenceId(id) ? await absenceRepository.findAbsenceById(id) : null;
    if (!absence) throw new DomainError('Ausencia no encontrada.', 404);

    const updated = await absenceRepository.markMissed(id);
    if (!updated) {
      throw new DomainError('La ausencia no está esperando confirmación.', 409, {
        code: 'absence_not_pending_ack',
      });
    }

    const replacement = await nameOf(absence.replacement_user_id);
    await absenceRepository.addAbsenceEvent(
      id,
      'candidate_missed',
      `${replacement || 'El reemplazo'} dejó vencer su plazo`
    );

    return { ...updated, missed_user_id: absence.replacement_user_id, missed_name: replacement };
  }

  // Interno (Recommendation): ausencias cuyo plazo de «Enterado» ya venció.
  function getExpired() {
    return absenceRepository.findExpiredPendingAck(new Date().toISOString());
  }

  // Seguimiento del turno: ausencias de los vuelos de un día, con su línea de tiempo.
  async function getTracking({ date } = {}) {
    if (date !== undefined && !datePattern.test(date)) {
      throw new DomainError('date debe tener el formato AAAA-MM-DD.', 400, { field: 'date' });
    }

    const absences = await absenceRepository.findAbsencesByDepartureDay(date || todayInBogota());
    const named = await attachUserNames(absences, NAME_FIELDS);
    const events = await absenceRepository.findEventsByAbsences(named.map((a) => a.id));

    return named.sort(trackingOrder).map((absence) => ({
      id: absence.id,
      code: absence.code,
      flight_id: absence.flight_id,
      flight_number: absence.flight_number,
      origin: absence.flight_origin,
      destination: absence.flight_destination,
      departure_at: absence.flight_departure_at,
      slot_role: absence.slot_role,
      reason: absence.reason,
      notes: absence.notes,
      reported_by: absence.crew_name,
      employee_code: absence.employee_code,
      reported_at: absence.created_at,
      status: absence.status,
      suggestions_state: absence.status === 'reported' ? absence.suggestions_state : null,
      candidate_count: absence.candidate_count ?? 0,
      replacement: absence.replacement_user_id
        ? { user_id: absence.replacement_user_id, full_name: absence.replacement_name, option: absence.replacement_option }
        : null,
      approval: absence.approved_at
        ? { by: absence.approved_by_name, at: absence.approved_at }
        : null,
      deadline_at: absence.deadline_at,
      confirmed_at: absence.covered_at,
      timeline: events
        .filter((event) => event.absence_id === absence.id)
        .map(({ at, type, text }) => ({ at, type, text, missed: type === 'candidate_missed' })),
    }));
  }

  async function getStats() {
    const row = await absenceRepository.getAbsenceStats(new Date().toISOString());
    return {
      reported: row.reported,
      pending_ack: row.pending_ack,
      covered_today: row.covered_today,
      resolution_rate: row.total_30d > 0
        ? Math.round((row.covered_30d / row.total_30d) * 1000) / 10
        : null,
    };
  }

  return { approveReplacement, acknowledgeAbsence, markMissed, getExpired, getTracking, getStats };
}

module.exports = createAbsenceWorkflow;
