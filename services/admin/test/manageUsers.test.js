const { test } = require('node:test');
const assert = require('node:assert/strict');

const createManageUsers = require('../src/application/use-cases/manageUsers');
const { DomainError } = require('../src/domain/errors');

const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

// Repositorio falso: solo findById, sin PostgreSQL.
function createFakeRepository(users) {
  return {
    async findById(id) {
      return users.find((user) => user.id === id) || null;
    },
  };
}

function isUnauthorized(error) {
  assert.ok(error instanceof DomainError, `se esperaba DomainError, llegó ${error && error.name}`);
  assert.equal(error.status, 401);
  return true;
}

test('LR-B6: getCurrentUser con un usuario activo devuelve el usuario', async () => {
  const user = { id: USER_ID, name: 'Ana Pérez', role: 'crew', is_active: true };
  const { getCurrentUser } = createManageUsers(createFakeRepository([user]));

  const result = await getCurrentUser({ id: USER_ID, role: 'crew' });

  assert.deepEqual(result, user);
});

test('LR-B6: getCurrentUser con un usuario desactivado lanza DomainError 401', async () => {
  const user = { id: USER_ID, name: 'Ana Pérez', role: 'crew', is_active: false };
  const { getCurrentUser } = createManageUsers(createFakeRepository([user]));

  await assert.rejects(getCurrentUser({ id: USER_ID, role: 'crew' }), isUnauthorized);
});

test('LR-B6: getCurrentUser con un usuario inexistente lanza DomainError 401', async () => {
  const { getCurrentUser } = createManageUsers(createFakeRepository([]));

  await assert.rejects(getCurrentUser({ id: USER_ID, role: 'crew' }), isUnauthorized);
});
