const { DomainError } = require('../errors');

// available: libre para asignar · on_duty: de turno en tierra
// in_flight: volando · medical_leave: incapacidad médica
const CREW_STATUSES = ['available', 'on_duty', 'in_flight', 'medical_leave'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Valida y normaliza los datos de un tripulante nuevo.
// name y email son de la cuenta en Admin; el resto es el perfil en Crew.
function createCrewMember({
  name,
  email,
  employeeCode,
  position,
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

  if (
    (currentLocation !== null && !isNonEmptyString(currentLocation)) ||
    !CREW_STATUSES.includes(status)
  ) {
    throw new DomainError(
      `currentLocation debe ser un texto no vacío y status debe ser uno de: ${CREW_STATUSES.join(', ')}.`
    );
  }

  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    employeeCode: employeeCode.trim(),
    position: position.trim(),
    currentLocation: currentLocation === null ? null : currentLocation.trim(),
    status,
    isActive,
  };
}

// Solo un tripulante disponible puede proponerse como reemplazo.
function isAvailable(crewMember) {
  return crewMember.status === 'available' && crewMember.isActive !== false;
}

module.exports = { CREW_STATUSES, createCrewMember, isAvailable };
