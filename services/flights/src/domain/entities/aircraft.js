const { DomainError } = require('../errors');
const { findModel, findBase, findMaintenanceType } = require('../aircraftCatalog');

// operating: en servicio · maintenance: en hangar, fuera de servicio.
// 'inactive' solo existe en filas antiguas de la base: ya no se asigna.
const AIRCRAFT_STATUSES = ['operating', 'maintenance'];

// Matrícula FAA: N, un dígito del 1 al 9 y hasta 4 caracteres más (números, o
// letras al final). Ej. N391DN, N12345, N1A.
const REGISTRATION_PATTERN = /^N[1-9](?:\d{0,4}|\d{0,3}[A-Z]|\d{0,2}[A-Z]{2})$/;
// Número de serie del fabricante (MSN): de 3 a 8 números.
const MSN_PATTERN = /^\d{3,8}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_MANUFACTURE_YEAR = 1980;
const MAX_MAINTENANCE_NOTE_LENGTH = 300;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidAircraftId(id) {
  return typeof id === 'string' && uuidPattern.test(id);
}

// 'AAAA-MM-DD' de un día que exista, o null.
function parseDay(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

function todayIso(now) {
  return now.toISOString().slice(0, 10);
}

// Valida lo que envía el super_admin al registrar o editar una aeronave.
// La capacidad y la tripulación mínima salen del modelo; las horas y los ciclos
// no se envían: empiezan en 0.
function validateAircraftInput(input, now = new Date()) {
  const {
    registration,
    msn,
    model_id: modelId,
    base,
    manufacture_year: manufactureYear,
    in_fleet_since: inFleetSince,
    status = 'operating',
    maintenance_type: maintenanceType = null,
    maintenance_note: maintenanceNote = null,
  } = input || {};

  const plate = typeof registration === 'string' ? registration.replace(/\s+/g, '').toUpperCase() : '';
  if (!REGISTRATION_PATTERN.test(plate)) {
    throw new DomainError('registration no es una matrícula FAA válida, ej. N391DN.');
  }

  const serial = typeof msn === 'string' ? msn.trim() : '';
  if (!MSN_PATTERN.test(serial)) {
    throw new DomainError('msn debe tener de 3 a 8 números, ej. 10342.');
  }

  const model = findModel(modelId);
  if (!model) {
    throw new DomainError('model_id no es un modelo de la flota.');
  }

  const fleetBase = findBase(typeof base === 'string' ? base.trim().toUpperCase() : base);
  if (!fleetBase) {
    throw new DomainError('base no es una base de la flota.');
  }

  const currentYear = now.getUTCFullYear();
  if (
    !Number.isInteger(manufactureYear) ||
    manufactureYear < MIN_MANUFACTURE_YEAR ||
    manufactureYear > currentYear
  ) {
    throw new DomainError(
      `manufacture_year debe ser un año entre ${MIN_MANUFACTURE_YEAR} y ${currentYear}.`
    );
  }

  const arrival = parseDay(inFleetSince);
  if (!arrival) {
    throw new DomainError('in_fleet_since debe ser una fecha válida AAAA-MM-DD.');
  }
  if (arrival > todayIso(now)) {
    throw new DomainError('in_fleet_since no puede ser una fecha futura.');
  }
  if (Number(arrival.slice(0, 4)) < manufactureYear) {
    throw new DomainError('in_fleet_since no puede ser anterior al año de fabricación.');
  }

  if (!AIRCRAFT_STATUSES.includes(status)) {
    throw new DomainError(`status debe ser uno de: ${AIRCRAFT_STATUSES.join(', ')}.`);
  }

  let maintenance = { type: null, note: null };

  if (status === 'maintenance') {
    if (!findMaintenanceType(maintenanceType)) {
      throw new DomainError('Una aeronave en mantenimiento necesita un maintenance_type válido.');
    }
    if (
      maintenanceNote !== null &&
      (typeof maintenanceNote !== 'string' ||
        maintenanceNote.trim().length > MAX_MAINTENANCE_NOTE_LENGTH)
    ) {
      throw new DomainError(
        `maintenance_note debe ser un texto de máximo ${MAX_MAINTENANCE_NOTE_LENGTH} caracteres.`
      );
    }
    const note = maintenanceNote === null ? '' : maintenanceNote.trim();
    maintenance = { type: maintenanceType, note: note === '' ? null : note };
  } else if (maintenanceType !== null || maintenanceNote !== null) {
    throw new DomainError('maintenance_type y maintenance_note solo aplican en mantenimiento.');
  }

  return {
    registration: plate,
    msn: serial,
    modelId: model.id,
    // name, capacity y minimum_crew se guardan con los datos del modelo: así
    // las asignaciones de vuelo siguen mostrando el nombre de la aeronave.
    name: model.name,
    family: model.family,
    capacity: model.capacity,
    minimumCrew: model.minimum_crew.pilots + model.minimum_crew.cabin,
    base: fleetBase.code,
    manufactureYear,
    inFleetSince: arrival,
    status,
    maintenanceType: maintenance.type,
    maintenanceNote: maintenance.note,
  };
}

// Solo una aeronave en operación puede programarse en un vuelo.
function canBeScheduled(aircraft) {
  return aircraft.status === 'operating';
}

// Sin mayúsculas ni tildes: «los angeles» encuentra «Los Ángeles».
function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// Página, búsqueda y estado de la lista de la flota.
function parseAircraftListParams({ page, page_size: pageSize, search, status } = {}) {
  const pageNumber = page === undefined || page === '' ? 1 : Number(page);
  const size = pageSize === undefined || pageSize === '' ? DEFAULT_PAGE_SIZE : Number(pageSize);

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new DomainError('page debe ser un entero mayor o igual a 1.');
  }

  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new DomainError(`page_size debe ser un entero de 1 a ${MAX_PAGE_SIZE}.`);
  }

  if (status !== undefined && status !== '' && !AIRCRAFT_STATUSES.includes(status)) {
    throw new DomainError(`status debe ser uno de: ${AIRCRAFT_STATUSES.join(', ')}.`);
  }

  return {
    page: pageNumber,
    pageSize: size,
    search: typeof search === 'string' ? normalizeSearchText(search) : '',
    status: status || null,
  };
}

// ¿El texto buscado aparece en la matrícula, el modelo, el número de serie o la base?
function matchesSearch(aircraft, search) {
  return (
    !search ||
    [aircraft.registration, aircraft.model_name, aircraft.msn, aircraft.base_name].some(
      (value) => normalizeSearchText(value).includes(search)
    )
  );
}

module.exports = {
  AIRCRAFT_STATUSES,
  isValidAircraftId,
  validateAircraftInput,
  canBeScheduled,
  parseAircraftListParams,
  matchesSearch,
};
