const { test } = require('node:test');
const assert = require('node:assert/strict');

const createInviteCrewUser = require('../src/application/use-cases/inviteCrewUser');

const CREATED = {
  id: '7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d',
  name: 'Tripulante de Prueba',
  email: 'tripulante@aircrew.test',
  role: 'crew',
  is_active: false,
  created_at: new Date('2026-11-18T12:00:00Z'),
};

const INPUT = { name: CREATED.name, email: CREATED.email };

// Hasher falso: evita bcrypt en los tests.
const passwordHasher = { hash: async (value) => `hash:${value.length}` };

function createFakeRepository({ createError, deleteError } = {}) {
  const calls = { create: 0, deleted: [] };
  return {
    calls,
    async createPendingCrewUser() {
      calls.create += 1;
      if (createError) throw createError;
      return CREATED;
    },
    async deletePendingCrewUser(id) {
      calls.deleted.push(id);
      if (deleteError) throw deleteError;
      return true;
    },
  };
}

function createFakeEmailClient(sendError) {
  const calls = { sent: 0 };
  return {
    calls,
    async sendCrewInvitation() {
      calls.sent += 1;
      if (sendError) throw sendError;
      return { id: 'correo-1' };
    },
  };
}

function emailError() {
  const error = new Error('Resend no pudo enviar la invitación al tripulante.');
  error.status = 502;
  return error;
}

test('IC-01: si el correo se envía, devuelve la cuenta y no borra nada', async () => {
  const userRepository = createFakeRepository();
  const emailClient = createFakeEmailClient();
  const inviteCrewUser = createInviteCrewUser({ userRepository, passwordHasher, emailClient });

  const result = await inviteCrewUser(INPUT);

  assert.equal(result.id, CREATED.id);
  assert.equal(emailClient.calls.sent, 1);
  assert.deepEqual(userRepository.calls.deleted, []);
});

test('IC-02: si el correo falla, borra la cuenta pendiente creada y relanza el mismo error', async () => {
  const sendError = emailError();
  const userRepository = createFakeRepository();
  const emailClient = createFakeEmailClient(sendError);
  const inviteCrewUser = createInviteCrewUser({ userRepository, passwordHasher, emailClient });

  await assert.rejects(inviteCrewUser(INPUT), (error) => {
    assert.equal(error, sendError);
    assert.equal(error.status, 502);
    return true;
  });
  assert.deepEqual(userRepository.calls.deleted, [CREATED.id]);
});

test('IC-03: si el correo falla y el borrado también, relanza el error del correo', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const sendError = emailError();
  const userRepository = createFakeRepository({ deleteError: new Error('fallo de base de datos') });
  const emailClient = createFakeEmailClient(sendError);
  const inviteCrewUser = createInviteCrewUser({ userRepository, passwordHasher, emailClient });

  await assert.rejects(inviteCrewUser(INPUT), (error) => {
    assert.equal(error, sendError);
    return true;
  });
  assert.deepEqual(userRepository.calls.deleted, [CREATED.id]);
  assert.equal(log.mock.callCount(), 1);
});

test('IC-04: si crear la cuenta falla, no envía el correo ni borra nada', async () => {
  const duplicate = new Error('Ya existe un usuario con ese email.');
  duplicate.status = 409;
  const userRepository = createFakeRepository({ createError: duplicate });
  const emailClient = createFakeEmailClient();
  const inviteCrewUser = createInviteCrewUser({ userRepository, passwordHasher, emailClient });

  await assert.rejects(inviteCrewUser(INPUT), (error) => {
    assert.equal(error, duplicate);
    return true;
  });
  assert.equal(emailClient.calls.sent, 0);
  assert.deepEqual(userRepository.calls.deleted, []);
});
