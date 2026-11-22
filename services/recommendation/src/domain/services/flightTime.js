// Cálculos de tiempo que comparten las reglas y el puntaje.
const HOUR_MS = 60 * 60 * 1000;

const time = (value) => new Date(value).getTime();

function durationHours(flight) {
  return (time(flight.arrival_at) - time(flight.departure_at)) / HOUR_MS;
}

function overlaps(a, b) {
  return time(a.departure_at) < time(b.arrival_at) && time(b.departure_at) < time(a.arrival_at);
}

// Mes calendario (UTC) de un vuelo, como "2026-11".
function monthOf(value) {
  return new Date(value).toISOString().slice(0, 7);
}

// Horas voladas en el mes del vuelo, sin contar el propio vuelo.
function monthHours(flight, memberAssignments) {
  const month = monthOf(flight.departure_at);

  return memberAssignments
    .filter(({ flight: other }) => other.id !== flight.id && monthOf(other.departure_at) === month)
    .reduce((total, { flight: other }) => total + durationHours(other), 0);
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

module.exports = { HOUR_MS, durationHours, overlaps, monthOf, monthHours, restHoursBefore };
