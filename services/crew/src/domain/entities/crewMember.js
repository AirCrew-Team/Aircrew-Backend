const { DomainError } = require('../errors');

// available: libre para asignar · on_duty: de guardia en el aeropuerto
// in_flight: volando · medical_leave: incapacidad médica · vacation: vacaciones
const CREW_STATUSES = ['available', 'on_duty', 'in_flight', 'medical_leave', 'vacation'];

// Cargo a bordo. Los pilotos son captain y first_officer; la cabina, purser
// (jefe de cabina) y flight_attendant (auxiliar de vuelo).
const CREW_RANKS = ['captain', 'first_officer', 'purser', 'flight_attendant'];

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function optionalText(value, name) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new DomainError(`${name} debe ser un texto no vacío.`, 400, { field: name });
  }

  return value.trim();
}

function optionalDate(value, name) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || !isoDatePattern.test(value)) {
    throw new DomainError(`${name} debe ser una fecha AAAA-MM-DD.`, 400, { field: name });
  }

  return value;
}

// Valida y normaliza los datos de un tripulante nuevo.
// name y email son de la cuenta en Admin; el resto es el perfil en Crew.
function createCrewMember({
  name,
  email,
  employeeCode,
  position,
  rank,
  baseCode = null,
  ratings = [],
  englishLevel = null,
  medicalExpiresOn = null,
  hireDate = null,
  phone = null,
  currentLocation = null,
  status = 'available',
  isActive = true,
}) {
  if (
    !isNonEmptyString(name) ||
    !isNonEmptyString(email) ||
    !isNonEmptyString(employeeCode) ||
    !isNonEmptyString(position)
  ) {
    throw new DomainError('Se requieren name, email, employeeCode y position.');
  }

  if (!CREW_RANKS.includes(rank)) {
    throw new DomainError(`rank debe ser uno de: ${CREW_RANKS.join(', ')}.`, 400, {
      field: 'rank',
    });
  }

  if (!CREW_STATUSES.includes(status)) {
    throw new DomainError(`status debe ser uno de: ${CREW_STATUSES.join(', ')}.`, 400, {
      field: 'status',
    });
  }

  if (!Array.isArray(ratings) || !ratings.every(isNonEmptyString)) {
    throw new DomainError('ratings debe ser una lista de familias de avión, por ejemplo ["A320"].', 400, {
      field: 'ratings',
    });
  }

  if (
    englishLevel !== null &&
    (!Number.isInteger(englishLevel) || englishLevel < 1 || englishLevel > 6)
  ) {
    throw new DomainError('englishLevel debe ser un número de 1 a 6 (nivel OACI).', 400, {
      field: 'englishLevel',
    });
  }

  const base = optionalText(baseCode, 'baseCode');
  const location = optionalText(currentLocation, 'currentLocation');

  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    employeeCode: employeeCode.trim(),
    position: position.trim(),
    rank,
    baseCode: base ? base.toUpperCase() : null,
    ratings: [...new Set(ratings.map((item) => item.trim().toUpperCase()))],
    englishLevel,
    medicalExpiresOn: optionalDate(medicalExpiresOn, 'medicalExpiresOn'),
    hireDate: optionalDate(hireDate, 'hireDate'),
    phone: optionalText(phone, 'phone'),
    currentLocation: location ? location.toUpperCase() : null,
    status,
    isActive,
  };
}

module.exports = { CREW_STATUSES, CREW_RANKS, createCrewMember };
