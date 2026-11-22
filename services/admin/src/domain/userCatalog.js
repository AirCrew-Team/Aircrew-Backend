// Catálogos del formulario de la pantalla Usuarios (super_admin). Son la única
// fuente: el frontend los pide con GET /catalogs/user-options.

const { HUBS } = require('@vuelos/shared');

// Hubs de Delta (@vuelos/shared): base de supervisores y tripulantes. La etiqueta
// es «Base <código> / <ciudad>», salvo donde la ciudad sola no basta.
const BASE_PLACE = { MSP: 'Minneapolis–St. Paul', LGA: 'Nueva York LaGuardia' };
const USER_BASES = Object.freeze(
  HUBS.map((hub) =>
    Object.freeze({ code: hub.code, label: `Base ${hub.code} / ${BASE_PLACE[hub.code] || hub.city}` })
  )
);

// Cargos de un tripulante. Se guardan tal cual en su perfil de Crew (position).
const CREW_POSITIONS = Object.freeze([
  'Comandante',
  'Copiloto',
  'Auxiliar de Vuelo',
  'Sobrecargo Principal',
  'Sobrecargo',
]);

// Turno del supervisor.
const SHIFT_OPTIONS = Object.freeze([
  { code: 'morning', label: 'Turno 1 (mañana)' },
  { code: 'afternoon', label: 'Turno 2 (tarde)' },
  { code: 'night', label: 'Turno 3 (noche)' },
]);

// Estado del tripulante (perfil de Crew).
const CREW_STATUS_OPTIONS = Object.freeze([
  { code: 'available', label: 'Disponible' },
  { code: 'on_duty', label: 'En guardia' },
  { code: 'in_flight', label: 'En vuelo' },
  { code: 'medical_leave', label: 'Permiso médico' },
  { code: 'vacation', label: 'Vacaciones' },
]);

// Estado operativo del supervisor (datos laborales de Admin).
const SUPERVISOR_STATUS_OPTIONS = Object.freeze([
  { code: 'available', label: 'Disponible' },
  { code: 'on_duty', label: 'En turno' },
  { code: 'off_duty', label: 'Fuera de turno' },
  { code: 'leave', label: 'De licencia' },
]);

// Cargo del catálogo sin importar mayúsculas ni espacios, con la forma del catálogo.
function findCrewPosition(value) {
  if (typeof value !== 'string') return null;
  const wanted = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return CREW_POSITIONS.find((position) => position.toLowerCase() === wanted) || null;
}

function userFormOptions() {
  return {
    bases: USER_BASES,
    crew_positions: CREW_POSITIONS,
    shifts: SHIFT_OPTIONS,
    crew_statuses: CREW_STATUS_OPTIONS,
    supervisor_statuses: SUPERVISOR_STATUS_OPTIONS,
  };
}

module.exports = {
  USER_BASES,
  CREW_POSITIONS,
  SHIFT_OPTIONS,
  CREW_STATUS_OPTIONS,
  SUPERVISOR_STATUS_OPTIONS,
  findCrewPosition,
  userFormOptions,
};
