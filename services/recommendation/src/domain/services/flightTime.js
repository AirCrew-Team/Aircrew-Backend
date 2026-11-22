// Cálculos de tiempo que comparten las reglas y el puntaje.
const { crewMonth } = require('@vuelos/shared');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const time = (value) => new Date(value).getTime();

function durationHours(flight) {
  return (time(flight.arrival_at) - time(flight.departure_at)) / HOUR_MS;
}

function overlaps(a, b) {
  return time(a.departure_at) < time(b.arrival_at) && time(b.departure_at) < time(a.arrival_at);
}

// Horas voladas en el mes del vuelo, sin contar el propio vuelo. El mes es el local de
// la base del tripulante (crewMonth de @vuelos/shared, el mismo de Mis Vuelos).
function monthHours(flight, memberAssignments, base) {
  const month = crewMonth(flight.departure_at, base);

  return memberAssignments
    .filter(({ flight: other }) => other.id !== flight.id && crewMonth(other.departure_at, base) === month)
    .reduce((total, { flight: other }) => total + durationHours(other), 0);
}

// Rango UTC de asignaciones a pedir para evaluar los vuelos que salen entre start y
// end: el mes local de cada uno (en cualquier hub, de UTC−4 a UTC−8, que puede ser el
// anterior al mes UTC) más un día a cada lado para el descanso. Pide algo de más.
function assignmentsWindow(start, end) {
  const first = new Date(time(start) - DAY_MS);
  const last = new Date(time(end) + DAY_MS);
  return {
    from: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1) + DAY_MS).toISOString(),
  };
}

// Horas de descanso entre la última llegada antes del vuelo y su salida.
// null si no tiene vuelos antes en el período consultado.
function restHoursBefore(flight, memberAssignments) {
  const previous = memberAssignments
    .map(({ flight: other }) => other)
    .filter((other) => other.id !== flight.id && time(other.arrival_at) <= time(flight.departure_at))
    .sort((a, b) => time(b.arrival_at) - time(a.arrival_at))[0];

  return previous ? (time(flight.departure_at) - time(previous.arrival_at)) / HOUR_MS : null;
}

module.exports = { HOUR_MS, durationHours, overlaps, monthHours, assignmentsWindow, restHoursBefore };
