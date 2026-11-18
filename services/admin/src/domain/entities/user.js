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
    throw new DomainError('role debe ser supervisor o super_admin.');
  }

  // Un tripulante necesita su perfil en Crew; Crew crea la cuenta y el perfil juntos.
  if (role.trim() === 'crew') {
    throw new DomainError(
      'Los tripulantes se registran con POST /crew/crew-members.'
    );
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

const STAFF_ROLES = ['supervisor', 'super_admin'];
const MAX_LOOKUP_IDS = 200;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUserId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

// Filtros opcionales de la lista de usuarios.
function parseUserFilters({ search, role } = {}) {
  if (role !== undefined && role !== '' && !ROLES.includes(role)) {
    throw new DomainError(`role debe ser uno de: ${ROLES.join(', ')}.`);
  }

  return {
    search: typeof search === 'string' && search.trim() ? search.trim() : null,
    role: role || null,
  };
}

// Cambios que un super_admin puede hacer a un usuario. Solo se aplican los
// campos enviados. La contraseña no se cambia aquí.
function validateUserUpdate(requester, target, input) {
  const { name, email, role, is_active: isActive } = input || {};
  const changes = {};

  if (name !== undefined) {
    if (!isNonEmptyString(name)) {
      throw new DomainError('name no puede estar vacío.');
    }
    changes.name = name.trim();
  }

  if (email !== undefined) {
    if (!isNonEmptyString(email)) {
      throw new DomainError('email no puede estar vacío.');
    }
    changes.email = normalizeEmail(email);
  }

  if (role !== undefined) {
    // Un tripulante tiene perfil en Crew: su rol no se cambia desde aquí.
    if (target.role === 'crew' || !STAFF_ROLES.includes(role)) {
      throw new DomainError(
        'Solo se puede cambiar el rol entre supervisor y super_admin.'
      );
    }
    changes.role = role;
  }

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      throw new DomainError('is_active debe ser true o false.');
    }
    // Activarla aquí rompería su enlace de activación.
    if (isActive === true && target.pending_activation) {
      throw new DomainError(
        'La cuenta está pendiente de activación: el tripulante debe activarla desde su correo.',
        409
      );
    }
    changes.isActive = isActive;
  }

  if (Object.keys(changes).length === 0) {
    throw new DomainError(
      'Envía al menos uno de: name, email, role, is_active.'
    );
  }

  // Evita que el super_admin se quede sin acceso por error.
  if (
    requester.id === target.id &&
    ((changes.role && changes.role !== 'super_admin') || changes.isActive === false)
  ) {
    throw new DomainError(
      'No puedes quitarte el rol de super_admin ni desactivar tu propia cuenta.',
      409
    );
  }

  return changes;
}

function validateLookupIds(ids) {
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_LOOKUP_IDS ||
    !ids.every(isValidUserId)
  ) {
    throw new DomainError(
      `Se requiere ids: una lista de 1 a ${MAX_LOOKUP_IDS} UUID.`
    );
  }

  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

module.exports = {
  ROLES,
  isValidUserId,
  parseUserFilters,
  validateUserUpdate,
  validateLookupIds,
  normalizeEmail,
  createUser,
  createSuperAdmin,
  createCrewInvitation,
  validateActivation,
  canLogIn,
  canViewUser,
};
