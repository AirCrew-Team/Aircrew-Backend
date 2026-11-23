const { DomainError } = require('../errors');

// available: libre para asignar · on_duty: de guardia en el aeropuerto
// in_flight: volando · medical_leave: incapacidad médica · vacation: vacaciones
const CREW_STATUSES = ['available', 'on_duty', 'in_flight', 'medical_leave', 'vacation'];

// Cargo a bordo. Los pilotos son captain y first_officer; la cabina, purser
// (jefe de cabina) y flight_attendant (auxiliar de vuelo).
const CREW_RANKS = ['captain', 'first_officer', 'purser', 'flight_attendant'];

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const employeeCodePattern = /^[A-Z0-9-]{3,30}$/;
// Código IATA del aeropuerto, p. ej. ATL. Admin decide cuáles hubs se usan.
const basePattern = /^[A-Z]{3}$/;
const MAX_POSITION_LENGTH = 40;

const EMPLOYEE_CODE_MESSAGE =
  'employee_code debe tener de 3 a 30 caracteres: letras, números o guiones.';
const POSITION_MESSAGE = `position debe ser un texto de 1 a ${MAX_POSITION_LENGTH} caracteres.`;
const BASE_MESSAGE = 'base debe ser un código IATA de 3 letras.';
const STATUS_MESSAGE = `status debe ser uno de: ${CREW_STATUSES.join(', ')}.`;

function isValidCrewUserId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

function parseEmployeeCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!employeeCodePattern.test(code)) throw new DomainError(EMPLOYEE_CODE_MESSAGE);
  return code;
}

function parsePosition(value) {
  const position = typeof value === 'string' ? value.trim() : '';
  if (position === '' || position.length > MAX_POSITION_LENGTH) {
    throw new DomainError(POSITION_MESSAGE);
  }
  return position;
}

// null o vacío → sin base.
function parseBase(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new DomainError(BASE_MESSAGE);
  const base = value.trim().toUpperCase();
  if (base === '') return null;
  if (!basePattern.test(base)) throw new DomainError(BASE_MESSAGE);
  return base;
}

function parseStatus(value) {
  if (!CREW_STATUSES.includes(value)) throw new DomainError(STATUS_MESSAGE);
  return value;
}

// Rango a bordo (el que usan las reglas de Recommendation) según el cargo del catálogo
// de Admin. null: cargo fuera del catálogo (al editar se conserva el rango que tuviera).
const RANK_BY_POSITION = {
  comandante: 'captain',
  copiloto: 'first_officer',
  'sobrecargo principal': 'purser',
  sobrecargo: 'flight_attendant',
  'auxiliar de vuelo': 'flight_attendant',
};

function rankForPosition(position) {
  const key = position.toLowerCase().replace(/\s+/g, ' ').trim();
  return Object.hasOwn(RANK_BY_POSITION, key) ? RANK_BY_POSITION[key] : null;
}

// Perfil de un tripulante nuevo. Lo pide Admin después de crear la cuenta;
// el nombre y el correo son de la cuenta y se quedan en Admin. Sin employee_code,
// el repositorio le asigna el siguiente (AC-0001, AC-0002…).
function createCrewProfile({
  user_id: userId,
  employee_code: employeeCode,
  position,
  base = null,
  status = 'available',
} = {}) {
  if (!isValidCrewUserId(userId)) {
    throw new DomainError('Se requiere un user_id válido.');
  }

  const profileBase = parseBase(base);

  return {
    userId,
    employeeCode:
      employeeCode === undefined || employeeCode === null || employeeCode === ''
        ? null
        : parseEmployeeCode(employeeCode),
    position: parsePosition(position),
    base: profileBase,
    // Recién creado, el tripulante está en su base.
    currentLocation: profileBase,
    status: parseStatus(status),
    rank: rankForPosition(parsePosition(position)),
  };
}

// Cambios que Admin puede hacer al perfil. Solo se aplican los campos enviados.
function validateCrewProfileUpdate(input) {
  const {
    employee_code: employeeCode,
    position,
    base,
    status,
    is_active: isActive,
  } = input || {};
  const changes = {};

  if (employeeCode !== undefined) changes.employeeCode = parseEmployeeCode(employeeCode);
  if (position !== undefined) {
    changes.position = parsePosition(position);
    changes.rank = rankForPosition(changes.position);
  }
  if (base !== undefined) changes.base = parseBase(base);
  if (status !== undefined) changes.status = parseStatus(status);

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      throw new DomainError('is_active debe ser true o false.');
    }
    changes.isActive = isActive;
  }

  if (Object.keys(changes).filter((key) => key !== 'rank').length === 0) {
    throw new DomainError(
      'Envía al menos uno de: employee_code, position, base, status, is_active.'
    );
  }

  return changes;
}

// Solo un tripulante disponible puede proponerse como reemplazo.
function isAvailable(crewMember) {
  return crewMember.status === 'available' && crewMember.isActive !== false;
}

module.exports = {
  CREW_STATUSES,
  isValidCrewUserId,
  createCrewProfile,
  validateCrewProfileUpdate,
  isAvailable,
};
