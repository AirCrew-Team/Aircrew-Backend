const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createCertificationAlert, canReceiveAlerts } = require('../src/domain/alerts');
const { tokenFromRequest } = require('../src/adapters/inbound/auth/sessionToken');
const ssePublisher = require('../src/adapters/outbound/publishers/ssePublisher');
const createNotifyUser = require('../src/application/use-cases/notifyUser');
const createManageMyNotifications = require('../src/application/use-cases/manageMyNotifications');
const createPublishAlert = require('../src/application/use-cases/publishAlert');
const { createAbsenceReportedAlert } = require('../src/domain/alerts');

const CREW_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';

// Respuesta falsa: guarda lo que se escribe en la conexión SSE.
function fakeResponse() {
  const res = { chunks: [], write: (chunk) => res.chunks.push(chunk) };
  return res;
}

// ---------------------------------------------------------------- dominio

test('aviso de certificado registrado y verificado', () => {
  const registered = createCertificationAlert({
    crew_user_id: CREW_ID,
    event: 'registered',
    actor_name: 'Asley Torres',
    license_number: '2775981',
    certificates: ['ATP', 'IR'],
  });
  assert.equal(registered.type, 'certification:registered');
  assert.equal(registered.message, 'Asley Torres te registró un certificado.');
  assert.deepEqual(registered.certificates, ['ATP', 'IR']);

  const verified = createCertificationAlert({ crew_user_id: CREW_ID, event: 'verified', license_number: '2775981' });
  assert.equal(verified.type, 'certification:verified');
  assert.equal(verified.message, 'Tu certificado 2775981 fue verificado.');

  const noActor = createCertificationAlert({ crew_user_id: CREW_ID, event: 'registered' });
  assert.equal(noActor.message, 'Un administrador te registró un certificado.');

  assert.throws(() => createCertificationAlert({ crew_user_id: 'x', event: 'registered' }), /crew_user_id/);
  assert.throws(() => createCertificationAlert({ crew_user_id: CREW_ID, event: 'updated' }), /registered o verified/);
});

test('solo los supervisores reciben las alertas operativas; el super_admin no', () => {
  assert.equal(canReceiveAlerts({ role: 'supervisor' }), true);
  assert.equal(canReceiveAlerts({ role: 'super_admin' }), false);
  assert.equal(canReceiveAlerts({ role: 'crew' }), false);
  assert.equal(canReceiveAlerts(null), false);
});

// ------------------------------------------------------- sesión del SSE

test('la sesión sale del header Authorization o de la cookie aircrew_token', () => {
  assert.equal(tokenFromRequest({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(tokenFromRequest({ headers: { cookie: 'otra=1; aircrew_token=xyz' } }), 'xyz');
  assert.equal(
    tokenFromRequest({ headers: { authorization: 'Bearer abc', cookie: 'aircrew_token=xyz' } }),
    'abc'
  );
  assert.equal(tokenFromRequest({ headers: { cookie: 'aircrew_token=%E0%A4%A' } }), null);
  assert.equal(tokenFromRequest({ headers: {} }), null);
});

// ------------------------------------------------------- publicador SSE

test('SSE: a supervisores solo llegan las alertas operativas; a una persona, solo las suyas', () => {
  const supervisor = fakeResponse();
  const superAdmin = fakeResponse();
  const crew = fakeResponse();
  const other = fakeResponse();
  const removers = [
    ssePublisher.addConnection({ id: 'sup', role: 'supervisor' }, supervisor),
    ssePublisher.addConnection({ id: 'adm', role: 'super_admin' }, superAdmin),
    ssePublisher.addConnection({ id: CREW_ID, role: 'crew' }, crew),
    ssePublisher.addConnection({ id: OTHER_ID, role: 'crew' }, other),
  ];

  try {
    assert.equal(ssePublisher.publishToSupervisors({ type: 'absence:reported', message: 'x' }), 1);
    assert.equal(ssePublisher.publishToUser(CREW_ID, { type: 'certification:registered', message: 'y' }), 1);

    assert.deepEqual(supervisor.chunks, ['event: absence:reported\ndata: {"type":"absence:reported","message":"x"}\n\n']);
    assert.deepEqual(superAdmin.chunks, []);
    assert.deepEqual(crew.chunks, ['event: certification:registered\ndata: {"type":"certification:registered","message":"y"}\n\n']);
    assert.deepEqual(other.chunks, []);
  } finally {
    removers.forEach((remove) => remove());
  }
  assert.equal(ssePublisher.connectionCount(), 0);
});

test('una persona con dos pestañas recibe el aviso en las dos', () => {
  const tabA = fakeResponse();
  const tabB = fakeResponse();
  const removers = [
    ssePublisher.addConnection({ id: CREW_ID, role: 'crew' }, tabA),
    ssePublisher.addConnection({ id: CREW_ID, role: 'crew' }, tabB),
  ];

  try {
    assert.equal(ssePublisher.publishToUser(CREW_ID, { type: 'assignment:replacement', message: 'z' }), 2);
  } finally {
    removers.forEach((remove) => remove());
  }
});

// ------------------------------------------------------------ historial

test('avisar a una persona: se guarda en su historial y sale en vivo con el id guardado', async () => {
  const saved = [];
  const published = [];
  const notifyUser = createNotifyUser({
    notificationRepository: {
      async insertNotification(data) {
        saved.push(data);
        return { id: NOTIFICATION_ID, created_at: '2026-11-22T10:00:00.000Z' };
      },
    },
    publisher: { publishToUser: (userId, alert) => published.push([userId, alert]) && 1 },
  });

  const result = await notifyUser(CREW_ID, {
    type: 'certification:registered',
    message: 'Asley Torres te registró un certificado.',
    crew_user_id: CREW_ID,
    license_number: '2775981',
    sent_at: 'ahora',
  });

  assert.deepEqual(saved, [
    {
      userId: CREW_ID,
      type: 'certification:registered',
      message: 'Asley Torres te registró un certificado.',
      data: { crew_user_id: CREW_ID, license_number: '2775981' },
    },
  ]);
  assert.equal(published[0][1].id, NOTIFICATION_ID);
  assert.equal(result.saved, true);
});

test('si guardar falla, el aviso sale en vivo igual', async (t) => {
  t.mock.method(console, 'error', () => {});
  let delivered = false;
  const notifyUser = createNotifyUser({
    notificationRepository: {
      async insertNotification() {
        throw new Error('base caída');
      },
    },
    publisher: {
      publishToUser: () => {
        delivered = true;
        return 1;
      },
    },
  });

  const result = await notifyUser(CREW_ID, { type: 'assignment:replacement', message: 'x' });

  assert.equal(delivered, true);
  assert.equal(result.saved, false);
});

test('la campana: lista con no leídos, marcar uno (solo los propios) y marcar todos', async () => {
  const calls = [];
  const row = { id: NOTIFICATION_ID, type: 'certification:verified', message: 'm', data: {}, read_at: null, created_at: 'hoy' };
  const manage = createManageMyNotifications({
    notificationRepository: {
      findVisible: async (viewer, options) => calls.push(['find', viewer, options]) && [row],
      countUnread: async () => 1,
      markRead: async (viewer, id) => (viewer.id === CREW_ID && id === NOTIFICATION_ID ? { ...row, read_at: 'ya' } : null),
      markAllRead: async () => 3,
    },
  });
  const user = { id: CREW_ID, role: 'crew' };

  const list = await manage.listMine(user, {});
  assert.equal(list.unread_count, 1);
  assert.equal(list.items[0].read, false);
  // Sin lector de preferencias no se excluye ningún tipo.
  assert.deepEqual(calls[0], ['find', user, { limit: 20, excludeTypes: [] }]);

  assert.equal((await manage.markRead(user, NOTIFICATION_ID)).read, true);
  await assert.rejects(manage.markRead({ id: OTHER_ID, role: 'crew' }, NOTIFICATION_ID), (error) => error.status === 404);
  await assert.rejects(manage.markRead(user, 'no-es-uuid'), (error) => error.status === 404);
  assert.deepEqual(await manage.markAllRead(user), { updated: 3 });
  await assert.rejects(manage.listMine(user, { limit: '0' }), (error) => error.status === 400);
});

test('alerta de supervisores: se guarda una vez para el rol y sale en vivo con el id guardado', async () => {
  const saved = [];
  const published = [];
  const publishAlert = createPublishAlert({
    buildAlert: createAbsenceReportedAlert,
    notificationRepository: {
      async insertNotification(data) {
        saved.push(data);
        return { id: NOTIFICATION_ID, created_at: '2026-11-22T10:00:00.000Z' };
      },
    },
    publisher: { publishToSupervisors: (alert) => published.push(alert) && 0 },
  });

  const result = await publishAlert({
    absence: { id: OTHER_ID, start_date: '2026-11-25', end_date: '2026-11-26', reason: 'fatigue', employee_code: 'AC-0001' },
  });

  // Nadie conectado: igual queda guardada para la campana.
  assert.equal(result.delivered_to, 0);
  assert.equal(result.saved, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].audienceRole, 'supervisor');
  assert.equal(saved[0].userId, undefined);
  assert.equal(saved[0].type, 'absence:reported');
  assert.equal(saved[0].data.absence.id, OTHER_ID);
  assert.equal(saved[0].data.sent_at, undefined);
  assert.equal(published[0].id, NOTIFICATION_ID);
});

test('si guardar la alerta de supervisores falla, sale en vivo igual', async (t) => {
  t.mock.method(console, 'error', () => {});
  const publishAlert = createPublishAlert({
    buildAlert: createAbsenceReportedAlert,
    notificationRepository: {
      async insertNotification() {
        throw new Error('base caída');
      },
    },
    publisher: { publishToSupervisors: () => 1 },
  });

  const result = await publishAlert({ absence: { id: OTHER_ID, flight_number: 'AC201', reason: 'illness' } });

  assert.equal(result.delivered_to, 1);
  assert.equal(result.saved, false);
});
