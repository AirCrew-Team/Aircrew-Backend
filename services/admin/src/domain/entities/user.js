const { DomainError } = require('../errors');
const { isValidPassword } = require('../value-objects/password');

const ROLES = ['crew', 'supervisor', 'super_admin'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Datos laborales del supervisor. Los asigna un super_admin; los demás roles no los tienen.
const SUPERVISOR_BASES = ['ATL', 'BOS', 'DTW', 'LAX', 'MSP', 'JFK', 'LGA', 'SLC', 'SEA'];
const SHIFTS = ['morning', 'afternoon', 'night'];
const OPERATIONAL_STATUSES = ['available', 'on_duty', 'off_duty', 'leave'];
const EMPLOYMENT_FIELDS = ['employee_code', 'base', 'shift', 'operational_status'];
const employeeCodePattern = /^[A-Z0-9-]{3,30}$/;

// null, vacío o solo espacios → null. Si no, el texto sin espacios en los extremos.
function optionalText(value, message) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new DomainError(message);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Se guarda en mayúsculas.
function parseEmployeeCode(value) {
  const message = 'employee_code debe tener de 3 a 30 caracteres: letras, números o guiones.';
  const text = optionalText(value, message);
  if (text === null) return null;

  const code = text.toUpperCase();
  if (!employeeCodePattern.test(code)) throw new DomainError(message);
  return code;
}

// Código del hub en mayúsculas.
function parseBase(value) {
  const message = `base debe ser uno de: ${SUPERVISOR_BASES.join(', ')}.`;
  const text = optionalText(value, message);
  if (text === null) return null;

  const base = text.toUpperCase();
  if (!SUPERVISOR_BASES.includes(base)) throw new DomainError(message);
  return base;
}

function parseShift(value) {
  const message = `shift debe ser uno de: ${SHIFTS.join(', ')}.`;
  const shift = optionalText(value, message);
  if (shift !== null && !SHIFTS.includes(shift)) throw new DomainError(message);
  return shift;
}

// El estado operativo de un supervisor siempre tiene valor: no se puede quitar.
function parseOperationalStatus(value) {
  if (!OPERATIONAL_STATUSES.includes(value)) {
    throw new DomainError(
      `operational_status debe ser uno de: ${OPERATIONAL_STATUSES.join(', ')}.`
    );
  }
  return value;
}

function hasEmploymentFields(input) {
  return EMPLOYMENT_FIELDS.some((field) => input[field] !== undefined);
}

// Se comprueba antes que los valores: a otro rol no le aplica ninguno.
function assertEmploymentAllowed(role, input) {
  if (role !== 'supervisor' && hasEmploymentFields(input)) {
    throw new DomainError('Los datos laborales solo aplican a supervisores.');
  }
}

// Solo los campos enviados, con los nombres que usa el repositorio.
function parseEmployment(input) {
  const employment = {};
  if (input.employee_code !== undefined) {
    employment.employeeCode = parseEmployeeCode(input.employee_code);
  }
  if (input.base !== undefined) employment.base = parseBase(input.base);
  if (input.shift !== undefined) employment.shift = parseShift(input.shift);
  if (input.operational_status !== undefined) {
    employment.operationalStatus = parseOperationalStatus(input.operational_status);
  }
  return employment;
}

// Usuario creado por un super_admin, con contraseña y rol definidos.
// Un supervisor puede traer sus datos laborales; empieza disponible.
function createUser(input) {
  const { name, email, password, role } = input;

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

  assertEmploymentAllowed(role.trim(), input);

  if (!isValidPassword(password)) {
    throw new DomainError('La contraseña debe tener entre 12 y 72 bytes.');
  }

  const employment =
    role.trim() === 'supervisor'
      ? {
          employeeCode: null,
          base: null,
          shift: null,
          operationalStatus: 'available',
          ...parseEmployment(input),
        }
      : null;

  return {
    name: name.trim(),
    email: normalizeEmail(email),
    password,
    role: role.trim(),
    employment,
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

// Correo para pedir el enlace de recuperación. Devuelve el correo normalizado.
function validatePasswordResetRequest({ email }) {
  if (!isNonEmptyString(email)) {
    throw new DomainError('Se requiere email.');
  }

  return normalizeEmail(email);
}

// Datos para restablecer la contraseña con el enlace del correo.
function validatePasswordReset({ token, password }) {
  if (!isNonEmptyString(token) || !isValidPassword(password)) {
    throw new DomainError(
      'Se requieren el token y una contraseña de 12 a 72 bytes.'
    );
  }
}

// Solo una cuenta activa con un rol conocido puede iniciar sesión.
function canLogIn(user) {
  return Boolean(user) && user.is_active === true && ROLES.includes(user.role);
}

// Una cuenta pendiente de activación usa su invitación, no la recuperación.
function canResetPassword(user) {
  return canLogIn(user) && !user.pending_activation;
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
  const fields = input || {};
  const { name, email, role, is_active: isActive } = fields;
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

  // Decide el rol que tendrá la cuenta después del cambio.
  assertEmploymentAllowed(changes.role || target.role, fields);
  if (hasEmploymentFields(fields)) {
    changes.employment = parseEmployment(fields);
  }

  if (changes.role && changes.role !== target.role) {
    if (target.role === 'supervisor') {
      // Deja de ser supervisor: se borran sus datos laborales y su código queda libre.
      changes.employment = {
        employeeCode: null,
        base: null,
        shift: null,
        operationalStatus: null,
      };
    } else if (changes.role === 'supervisor') {
      // Nuevo supervisor: empieza disponible, salvo que se envíe otro estado.
      changes.employment = { operationalStatus: 'available', ...changes.employment };
    }
  }

  if (Object.keys(changes).length === 0) {
    throw new DomainError(
      `Envía al menos uno de: name, email, role, is_active, ${EMPLOYMENT_FIELDS.join(', ')}.`
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
  validatePasswordResetRequest,
  validatePasswordReset,
  canLogIn,
  canResetPassword,
  canViewUser,
};
