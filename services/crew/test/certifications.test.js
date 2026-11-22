const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateCertificationInput,
  historyEventsFor,
  parseListParams,
  certificationOptions,
  VERIFICATION_NOTES,
} = require('../src/domain/entities/certification');
const { parseCertificateFile } = require('../src/domain/value-objects/certificateFile');
const createManageCertifications = require('../src/application/use-cases/manageCertifications');

const PILOT_ID = '11111111-1111-4111-8111-111111111111';
const PURSER_ID = '22222222-2222-4222-8222-222222222222';
const ATTENDANT_ID = '33333333-3333-4333-8333-333333333333';
const INACTIVE_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN = { id: ADMIN_ID, role: 'super_admin' };
const PDF = Buffer.from('%PDF-1.4 licencia');

function pdfFile(name = 'licencia.pdf') {
  return { file_name: name, mime_type: 'application/pdf', data_base64: PDF.toString('base64') };
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    if (message) assert.match(error.message, message);
    return true;
  };
}

// ---------------------------------------------------------------- dominio

test('cada cargo tiene sus certificados', () => {
  const { by_position: byPosition } = certificationOptions();

  assert.deepEqual(byPosition.Comandante.certificates, ['PPL', 'CPL', 'ATP', 'IR', 'ME']);
  assert.deepEqual(byPosition['Auxiliar de Vuelo'].certificates, ['CDP']);
  assert.deepEqual(byPosition.Sobrecargo.certificates, ['CDP', 'LID', 'CONF', 'ADU']);
  assert.equal(byPosition.Copiloto.area, 'flight_deck');
  assert.equal(byPosition['Sobrecargo Principal'].area, 'cabin');
});

test('número de licencia: solo dígitos, de 5 a 10', () => {
  for (const license of ['1234', '12345678901', '12a45', '', 12345, undefined]) {
    assert.throws(
      () => validateCertificationInput('Sobrecargo', { license_number: license, certificates: ['CDP'], verified: false }),
      /número de licencia/,
      String(license)
    );
  }
});

test('solo los certificados del cargo; un piloto necesita licencia y cabina el CDP', () => {
  const base = { license_number: '12345', verified: false };

  assert.throws(() => validateCertificationInput('Auxiliar de Vuelo', { ...base, certificates: ['CDP', 'LID'] }), /no permitidos para Auxiliar de Vuelo: LID/);
  assert.throws(() => validateCertificationInput('Copiloto', { ...base, certificates: ['IR', 'ME'] }), /al menos una licencia/);
  assert.throws(() => validateCertificationInput('Sobrecargo', { ...base, certificates: ['LID'] }), /CDP/);
  assert.throws(() => validateCertificationInput('Sobrecargo', { ...base, certificates: [] }), /al menos un certificado/);
});

test('un cargo fuera del catálogo responde 409', () => {
  assert.throws(
    () => validateCertificationInput('pilot', { license_number: '12345', certificates: ['ATP'], verified: true }),
    rejectsWith(409, /no tiene certificados definidos/)
  );
});

test('los códigos se normalizan, sin repetidos y en el orden del catálogo', () => {
  const result = validateCertificationInput('Comandante', {
    license_number: ' 2775981 ',
    certificates: ['me', 'ATP', 'ir', 'ATP'],
    verified: true,
  });

  assert.deepEqual(result, {
    area: 'flight_deck',
    licenseNumber: '2775981',
    certificates: ['ATP', 'IR', 'ME'],
    status: 'verified',
  });
  assert.throws(
    () => validateCertificationInput('Comandante', { license_number: '12345', certificates: ['ATP'], verified: 'si' }),
    /verified/
  );
});

test('la copia: PDF, PNG o JPG de hasta 5 MB y del tipo indicado', () => {
  const file = parseCertificateFile(pdfFile('licencia.html'));
  assert.equal(file.fileName, 'licencia.pdf');
  assert.equal(file.sizeBytes, PDF.length);

  assert.throws(() => parseCertificateFile({ ...pdfFile(), mime_type: 'image/gif' }), /PDF, PNG o JPG/);
  assert.throws(() => parseCertificateFile({ ...pdfFile(), mime_type: 'image/png' }), /no coincide/);
  const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
  assert.throws(
    () => parseCertificateFile({ file_name: 'x.pdf', mime_type: 'application/pdf', data_base64: big.toString('base64') }),
    /supera los 5 MB/
  );
});

test('historial: registrar, verificar y editar', () => {
  const pending = { status: 'pending_verification' };
  const verified = { status: 'verified' };

  assert.deepEqual(historyEventsFor(null, pending, 'cabin'), [{ event: 'registered', note: null }]);
  assert.deepEqual(historyEventsFor(null, verified, 'flight_deck'), [
    { event: 'registered', note: null },
    { event: 'verified', note: VERIFICATION_NOTES.flight_deck },
  ]);
  assert.deepEqual(historyEventsFor(pending, verified, 'cabin'), [
    { event: 'updated', note: null },
    { event: 'verified', note: VERIFICATION_NOTES.cabin },
  ]);
  assert.deepEqual(historyEventsFor(verified, verified, 'cabin'), [{ event: 'updated', note: null }]);
  // Quitar la verificación es una edición.
  assert.deepEqual(historyEventsFor(verified, pending, 'cabin'), [{ event: 'updated', note: null }]);
});

test('parámetros de la lista: 5 por página por defecto, como la pantalla', () => {
  assert.deepEqual(parseListParams({}), { page: 1, pageSize: 5, search: '', status: null });
  assert.throws(() => parseListParams({ status: 'verificado' }), /status/);
  assert.throws(() => parseListParams({ page: '0' }), /page/);
});

// ---------------------------------------------------------- caso de uso

function fakeRepository() {
  const members = new Map([
    [PILOT_ID, { user_id: PILOT_ID, employee_code: 'AC-1108', position: 'Comandante', base: 'ATL', is_active: true }],
    [PURSER_ID, { user_id: PURSER_ID, employee_code: 'AC-6014', position: 'Sobrecargo', base: 'SEA', is_active: true }],
    [ATTENDANT_ID, { user_id: ATTENDANT_ID, employee_code: 'AC-5520', position: 'Auxiliar de Vuelo', base: 'SEA', is_active: true }],
    [INACTIVE_ID, { user_id: INACTIVE_ID, employee_code: 'AC-0009', position: 'Copiloto', base: 'JFK', is_active: false }],
  ]);
  const certifications = new Map();
  const files = new Map();
  const events = [];

  const recordOf = (id) => {
    const member = members.get(id);
    if (!member) return null;
    const certification = certifications.get(id);
    const file = files.get(id);
    return {
      member,
      certification: certification
        ? { ...certification, file: file ? { file_name: file.fileName, mime_type: file.mimeType, size_bytes: file.sizeBytes } : null }
        : null,
    };
  };

  return {
    certifications,
    files,
    events,
    findActiveCrewCertifications: async () => [...members.values()].filter((m) => m.is_active).map((m) => recordOf(m.user_id)),
    findCrewCertification: async (id) => recordOf(id),
    findHistory: async (id) => events.filter((entry) => entry.crew_user_id === id).reverse(),
    findFile: async (id) => {
      const file = files.get(id);
      return file ? { file_name: file.fileName, mime_type: file.mimeType, data: file.data } : null;
    },
    withCertificationLock: async (id, fn) =>
      fn({
        findCertification: async (userId) => certifications.get(userId) || null,
        upsertCertification: async ({ crewUserId, licenseNumber, certificates, status }) => {
          certifications.set(crewUserId, { license_number: licenseNumber, certificates, status, updated_at: 'ahora' });
        },
        replaceFile: async ({ crewUserId, ...file }) => files.set(crewUserId, file),
        deleteFile: async (userId) => files.delete(userId),
        insertEvents: async (crewUserId, actorUserId, list) => {
          for (const { event, note } of list) events.push({ crew_user_id: crewUserId, event, actor_user_id: actorUserId, note, created_at: 'ahora' });
        },
      }),
    deleteCertification: async (id) => {
      const existed = certifications.delete(id);
      files.delete(id);
      return existed;
    },
  };
}

const USERS = [
  { id: PILOT_ID, name: 'Diego Salcedo', email: 'd.salcedo@aircrew.test' },
  { id: PURSER_ID, name: 'Laura Benítez', email: 'l.benitez@aircrew.test' },
  { id: ATTENDANT_ID, name: 'Valeria Ortiz', email: 'v.ortiz@aircrew.test' },
  { id: ADMIN_ID, name: 'Asley Torres', email: 'admin@aircrew.test' },
];

function setup({ findUsersByIds = async (ids) => USERS.filter((user) => ids.includes(user.id)) } = {}) {
  const certificationRepository = fakeRepository();
  return { repo: certificationRepository, manage: createManageCertifications({ certificationRepository, findUsersByIds }) };
}

test('registrar verificado: copia, historial con quién lo hizo y nota de verificación', async () => {
  const { manage } = setup();

  const detail = await manage.saveCertification(ADMIN, PILOT_ID, {
    license_number: '2775981',
    certificates: ['ATP', 'IR', 'ME'],
    verified: true,
    file: pdfFile('licencia-diego.pdf'),
  });

  assert.equal(detail.status, 'verified');
  assert.equal(detail.name, 'Diego Salcedo');
  assert.equal(detail.employee_code, 'AC-1108');
  assert.equal(detail.area, 'flight_deck');
  assert.deepEqual(detail.file, { file_name: 'licencia-diego.pdf', mime_type: 'application/pdf', size_bytes: PDF.length });
  assert.deepEqual(detail.history.map(({ event, by }) => [event, by]), [
    ['verified', 'Asley Torres'],
    ['registered', 'Asley Torres'],
  ]);
  assert.equal(detail.history[0].note, VERIFICATION_NOTES.flight_deck);
});

test('editar sin file deja la copia; con null la quita; quitar la verificación queda por verificar', async () => {
  const { manage, repo } = setup();
  const input = { license_number: '4818266', certificates: ['CDP'], verified: true };

  await manage.saveCertification(ADMIN, PURSER_ID, { ...input, file: pdfFile() });
  await manage.saveCertification(ADMIN, PURSER_ID, { ...input, certificates: ['CDP', 'LID'] });
  assert.ok(repo.files.has(PURSER_ID));

  const detail = await manage.saveCertification(ADMIN, PURSER_ID, { ...input, verified: false, file: null });
  assert.equal(detail.status, 'pending_verification');
  assert.equal(detail.file, null);
});

test('si los datos no cumplen las reglas no se guarda nada', async () => {
  const { manage, repo } = setup();

  await assert.rejects(
    manage.saveCertification(ADMIN, ATTENDANT_ID, { license_number: '12345', certificates: ['CDP', 'LID'], verified: true }),
    rejectsWith(400)
  );
  await assert.rejects(
    manage.saveCertification(ADMIN, PILOT_ID, { license_number: '12345', certificates: ['ATP'], verified: true, file: { ...pdfFile(), mime_type: 'image/png' } }),
    rejectsWith(400, /no coincide/)
  );
  assert.equal(repo.certifications.size, 0);
  assert.equal(repo.events.length, 0);
});

test('un tripulante desactivado no se puede certificar (409); uno inexistente es 404', async () => {
  const { manage } = setup();
  const input = { license_number: '12345', certificates: ['ATP'], verified: true };

  await assert.rejects(manage.saveCertification(ADMIN, INACTIVE_ID, input), rejectsWith(409, /desactivado/));
  await assert.rejects(manage.saveCertification(ADMIN, '55555555-5555-4555-8555-555555555555', input), rejectsWith(404));
  await assert.rejects(manage.getCertification('no-es-uuid'), rejectsWith(404));
});

test('lista: sin certificado primero, filtro, búsqueda sin tildes por nombre, ID o licencia, y solo activos', async () => {
  const { manage } = setup();
  await manage.saveCertification(ADMIN, PILOT_ID, { license_number: '2775981', certificates: ['ATP'], verified: true });
  await manage.saveCertification(ADMIN, PURSER_ID, { license_number: '4818266', certificates: ['CDP'], verified: false });

  const all = await manage.listCertifications({});
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((item) => item.status), ['uncertified', 'pending_verification', 'verified']);

  assert.deepEqual((await manage.listCertifications({ status: 'verified' })).items.map((i) => i.employee_code), ['AC-1108']);
  assert.deepEqual((await manage.listCertifications({ search: 'benitez' })).items.map((i) => i.employee_code), ['AC-6014']);
  assert.deepEqual((await manage.listCertifications({ search: 'ac-5520' })).items.map((i) => i.employee_code), ['AC-5520']);
  assert.deepEqual((await manage.listCertifications({ search: '27759' })).items.map((i) => i.employee_code), ['AC-1108']);
  assert.equal((await manage.listCertifications({ page: '2', page_size: '2' })).items.length, 1);
});

test('indicadores y tripulantes sin certificado para el formulario', async () => {
  const { manage } = setup();
  await manage.saveCertification(ADMIN, PILOT_ID, { license_number: '2775981', certificates: ['ATP'], verified: true });

  assert.deepEqual(await manage.getCertificationStats(), {
    total: 3,
    by_status: { verified: 1, pending_verification: 0, uncertified: 2 },
  });
  assert.deepEqual((await manage.listUncertifiedCrew()).map((item) => item.employee_code), ['AC-5520', 'AC-6014']);
});

test('eliminar deja al tripulante sin certificado; eliminar sin certificación es 404', async () => {
  const { manage } = setup();
  await manage.saveCertification(ADMIN, PURSER_ID, { license_number: '4818266', certificates: ['CDP'], verified: true, file: pdfFile() });

  await manage.deleteCertification(PURSER_ID);
  const detail = await manage.getCertification(PURSER_ID);
  assert.equal(detail.status, 'uncertified');
  assert.equal(detail.file, null);
  assert.deepEqual(detail.history, []);
  await assert.rejects(manage.deleteCertification(PURSER_ID), rejectsWith(404));
});

test('descargar la copia: los bytes originales; sin copia es 404', async () => {
  const { manage } = setup();
  await manage.saveCertification(ADMIN, PILOT_ID, { license_number: '2775981', certificates: ['ATP'], verified: true, file: pdfFile('licencia.pdf') });

  const file = await manage.getCertificationFile(PILOT_ID);
  assert.ok(file.data.equals(PDF));
  await assert.rejects(manage.getCertificationFile(PURSER_ID), rejectsWith(404, /no tiene una copia/));
});

test('si Admin no responde, la lista sale sin nombres', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { manage } = setup({
    findUsersByIds: async () => {
      throw new Error('Admin caído');
    },
  });

  const { items } = await manage.listCertifications({});
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.name === null));
});

// ------------------------------------- aviso al tripulante (Notification)

function setupWithNotifications({ notifyError } = {}) {
  const calls = [];
  const certificationRepository = fakeRepository();
  const manage = createManageCertifications({
    certificationRepository,
    findUsersByIds: async (ids) => USERS.filter((user) => ids.includes(user.id)),
    notifyCertification: async (payload) => {
      calls.push(payload);
      if (notifyError) throw notifyError;
    },
  });
  return { calls, manage };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('registrar avisa al tripulante con quién lo registró', async () => {
  const { calls, manage } = setupWithNotifications();

  await manage.saveCertification(ADMIN, PILOT_ID, { license_number: '2775981', certificates: ['ATP', 'IR'], verified: false });
  await flush();

  assert.deepEqual(calls, [
    { crewUserId: PILOT_ID, event: 'registered', actorName: 'Asley Torres', licenseNumber: '2775981', certificates: ['ATP', 'IR'] },
  ]);
});

test('pasar a verificado avisa «verified»; editar sin verificar o ya verificado no avisa', async () => {
  const { calls, manage } = setupWithNotifications();
  const input = { license_number: '4818266', certificates: ['CDP'], verified: false };

  await manage.saveCertification(ADMIN, PURSER_ID, input);
  await manage.saveCertification(ADMIN, PURSER_ID, { ...input, certificates: ['CDP', 'LID'] });
  await manage.saveCertification(ADMIN, PURSER_ID, { ...input, verified: true });
  await manage.saveCertification(ADMIN, PURSER_ID, { ...input, verified: true, certificates: ['CDP', 'ADU'] });
  await flush();

  assert.deepEqual(calls.map((call) => call.event), ['registered', 'verified']);
});

test('registrar ya verificado avisa una sola vez, como registrado', async () => {
  const { calls, manage } = setupWithNotifications();

  await manage.saveCertification(ADMIN, PILOT_ID, { license_number: '2775981', certificates: ['ATP'], verified: true });
  await flush();

  assert.deepEqual(calls.map((call) => call.event), ['registered']);
});

test('si Notification falla, la certificación queda guardada igual', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { manage } = setupWithNotifications({ notifyError: new Error('Notification caído') });

  const detail = await manage.saveCertification(ADMIN, PILOT_ID, { license_number: '2775981', certificates: ['ATP'], verified: true });
  await flush();

  assert.equal(detail.status, 'verified');
});
