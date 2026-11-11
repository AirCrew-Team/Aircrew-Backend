const { DomainError } = require('../errors');
const { isValidPassword } = require('../value-objects/password');

const ROLES = ['crew', 'supervisor', 'super_admin'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Usuario creado por un super_admin, con contraseña y rol definidos.
function createUser({ name, email, password, role }) {
  if (
    !isNonEmptyString(name) ||
    !isNonEmptyString(email) ||
    typeof password !== 'string' ||
    !password ||
    !isNonEmptyString(role)
  ) {
    throw new DomainError('Se requieren name, email, password y role.');
  }

  if (!ROLES.includes(role.trim())) {
    throw new DomainError(`role debe ser uno de: ${ROLES.join(', ')}.`);
  }

  if (!isValidPassword(password)) {
    throw new DomainError('La contraseña debe tener entre 12 y 72 bytes.');
  }

  return {
    name: name.trim(),
    email: normalizeEmail(email),
    password,
    role: role.trim(),
  };
}

// Primer super_admin del sistema.
function createSuperAdmin({ name, email, password }) {
  if (
    !isNonEmptyString(name) ||
    !isNonEmptyString(email) ||
    !isValidPassword(password)
  ) {
    throw new DomainError(
      'Se requieren name, email y una contraseña de 12 a 72 bytes.'
    );
  }

  return {
    name: name.trim(),
    email: normalizeEmail(email),
    password,
    role: 'super_admin',
  };
}

// Tripulante invitado: la cuenta nace inactiva y sin contraseña propia.
function createCrewInvitation({ name, email }) {
  if (!isNonEmptyString(name) || !isNonEmptyString(email)) {
    throw new DomainError('Se requieren name y email.');
  }

  return {
    name: name.trim(),
    email: normalizeEmail(email),
    role: 'crew',
  };
}

// Datos para activar una cuenta invitada.
function validateActivation({ token, password }) {
  if (!isNonEmptyString(token) || !isValidPassword(password)) {
    throw new DomainError(
      'Se requieren el token de activación y una contraseña de 12 a 72 bytes.'
    );
  }
}

// Solo una cuenta activa con un rol conocido puede iniciar sesión.
function canLogIn(user) {
  return Boolean(user) && user.is_active === true && ROLES.includes(user.role);
}

// super_admin ve cualquier usuario; los demás solo su propia cuenta.
function canViewUser(requester, userId) {
  return requester.role === 'super_admin' || requester.id === userId;
}

module.exports = {
  ROLES,
  normalizeEmail,
  createUser,
  createSuperAdmin,
  createCrewInvitation,
  validateActivation,
  canLogIn,
  canViewUser,
};
