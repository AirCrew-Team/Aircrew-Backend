const { DomainError } = require('../errors');
const { isValidPassword } = require('../value-objects/password');
const { parsePhone } = require('../profile');

const ROLES = ['crew', 'supervisor', 'super_admin'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Datos laborales del supervisor. Los asigna un super_admin; los demás roles no los tienen.
// BOG, MDE y CLO: bases de los datos de demo (database/seed-demo.js).
const SUPERVISOR_BASES = ['ATL', 'BOS', 'DTW', 'LAX', 'MSP', 'JFK', 'LGA', 'SLC', 'SEA', 'BOG', 'MDE', 'CLO'];
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

// Campos del perfil de Crew que solo tiene un tripulante.
const CREW_ONLY_FIELDS = ['position', 'status'];
// El tripulante también tiene código y base, pero en su perfil de Crew.
const CREW_PROFILE_FIELDS = ['employee_code', 'position', 'base', 'status'];

// Se comprueba antes que los valores: a otro rol no le aplica ninguno.
function assertEmploymentAllowed(role, input) {
  const supervisorOnly =
    role === 'crew' ? ['shift', 'operational_status'] : EMPLOYMENT_FIELDS;

  if (role !== 'supervisor' && supervisorOnly.some((field) => input[field] !== undefined)) {
    throw new DomainError('Los datos laborales solo aplican a supervisores.');
  }

  if (role !== 'crew' && CREW_ONLY_FIELDS.some((field) => input[field] !== undefined)) {
    throw new DomainError('position y status solo aplican a tripulantes.');
  }
}

// Perfil de Crew de un tripulante, con los nombres que espera Crew. Admin valida
// el código y el hub; Crew valida el cargo y el estado, y es quien lo guarda.
function parseCrewProfile(input, { required }) {
  const profile = {};

  if (required || input.employee_code !== undefined) {
    const code = parseEmployeeCode(input.employee_code ?? null);
    if (code === null) {
      throw new DomainError('Un tripulante necesita employee_code.');
    }
    profile.employee_code = code;
  }

  if (required || input.position !== undefined) {
    if (!isNonEmptyString(input.position)) {
      throw new DomainError('Un tripulante necesita position (su cargo).');
    }
    profile.position = input.position.trim();
  }

  if (input.base !== undefined) profile.base = parseBase(input.base);
  if (input.status !== undefined) profile.status = input.status;

  return profile;
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

// Usuario invitado por un super_admin: la cuenta nace pendiente y cada persona
// crea su contraseña al activarla desde el correo.
// Un supervisor puede traer sus datos laborales; empieza disponible.
// Un tripulante trae su perfil de Crew (código, cargo, base y estado).
function createUser(input) {
  const { name, email, password, role, phone } = input;

  if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(role)) {
    throw new DomainError('Se requieren name, email y role.');
  }

  if (password !== undefined) {
    throw new DomainError(
      'No envíes password: cada usuario crea su contraseña al activar su cuenta.'
    );
  }

  if (!ROLES.includes(role.trim())) {
    throw new DomainError(`role debe ser uno de: ${ROLES.join(', ')}.`);
  }

  assertEmploymentAllowed(role.trim(), input);

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
    phone: phone === undefined ? null : parsePhone(phone),
    role: role.trim(),
    employment,
    crewProfile: role.trim() === 'crew' ? parseCrewProfile(input, { required: true }) : null,
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
      'Se requieren name, email y una contraseña de mínimo 8 caracteres (máximo 72 bytes).'
    );
  }

  return {
    name: name.trim(),
    email: normalizeEmail(email),
    password,
    role: 'super_admin',
  };
}

// Datos para activar una cuenta invitada.
function validateActivation({ token, password }) {
  if (!isNonEmptyString(token) || !isValidPassword(password)) {
    throw new DomainError(
      'Se requieren el token de activación y una contraseña de mínimo 8 caracteres (máximo 72 bytes).'
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
      'Se requieren el token y una contraseña de 8 a 72 bytes.'
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

// La sesión del token sigue valiendo: la cuenta existe, está activa y el token no es
// anterior al último cambio de contraseña. El iat va en segundos, así que la fecha del
// cambio se redondea hacia abajo: un token del mismo segundo que el cambio vale.
// Sin password_changed_at no hay nada que comparar. verifyJwt exige un iat numérico.
function isCurrentSession(account, requester) {
  if (!account || account.is_active !== true) return false;
  if (!account.password_changed_at) return true;

  const changedAt = Math.floor(new Date(account.password_changed_at).getTime() / 1000);
  return !(requester.iat < changedAt);
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

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

// Sin mayúsculas ni tildes: «benitez» encuentra «Benítez».
function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// Página, búsqueda y rol de la lista de la pantalla Usuarios.
function parseUserListParams({ page, page_size: pageSize, search, role } = {}) {
  const pageNumber = page === undefined || page === '' ? 1 : Number(page);
  const size = pageSize === undefined || pageSize === '' ? DEFAULT_PAGE_SIZE : Number(pageSize);

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new DomainError('page debe ser un entero mayor o igual a 1.');
  }

  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new DomainError(`page_size debe ser un entero de 1 a ${MAX_PAGE_SIZE}.`);
  }

  return {
    page: pageNumber,
    pageSize: size,
    search: typeof search === 'string' ? normalizeSearchText(search) : '',
    role: parseUserFilters({ role }).role,
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

  if (fields.phone !== undefined) {
    changes.phone = parsePhone(fields.phone);
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
        'La cuenta está pendiente de activación: la persona debe activarla desde su correo.',
        409
      );
    }
    changes.isActive = isActive;
  }

  // Decide el rol que tendrá la cuenta después del cambio.
  assertEmploymentAllowed(changes.role || target.role, fields);
  if (target.role === 'crew') {
    // El rol de un tripulante no cambia: sus datos van a su perfil de Crew.
    if (CREW_PROFILE_FIELDS.some((field) => fields[field] !== undefined)) {
      changes.crewProfile = parseCrewProfile(fields, { required: false });
    }
  } else if (hasEmploymentFields(fields)) {
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
      `Envía al menos uno de: name, email, phone, role, is_active, ${EMPLOYMENT_FIELDS.join(', ')}, position, status.`
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
  parseUserListParams,
  normalizeSearchText,
  validateUserUpdate,
  validateLookupIds,
  normalizeEmail,
  createUser,
  createSuperAdmin,
  validateActivation,
  validatePasswordResetRequest,
  validatePasswordReset,
  canLogIn,
  canResetPassword,
  canViewUser,
  isCurrentSession,
};
