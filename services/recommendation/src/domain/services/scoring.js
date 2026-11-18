const HOUR_MS = 60 * 60 * 1000;
const LOAD_WINDOW_HOURS = 24;
const LOCATION_POINTS = 60;
const MAX_LOAD_POINTS = 40;
const POINTS_PER_FLIGHT = 20;

// Vuelos del tripulante en las 24 h antes de la salida y después de la llegada.
function countNearbyFlights(flight, memberAssignments) {
  const windowStart =
    new Date(flight.departure_at).getTime() - LOAD_WINDOW_HOURS * HOUR_MS;
  const windowEnd =
    new Date(flight.arrival_at).getTime() + LOAD_WINDOW_HOURS * HOUR_MS;

  return memberAssignments.filter(
    ({ flight: other }) =>
      other.id !== flight.id &&
      new Date(other.departure_at).getTime() < windowEnd &&
      new Date(other.arrival_at).getTime() > windowStart
  ).length;
}

// Puntaje de 0 a 100 de un tripulante que ya pasó las reglas, con sus motivos.
function scoreCandidate({ member, flight, memberAssignments }) {
  const reasons = ['Disponible', 'Cargo habilitado'];
  let score = 0;

  const location = String(member.current_location || '').trim().toUpperCase();

  if (location && location === flight.origin) {
    score += LOCATION_POINTS;
    reasons.push(`En ${flight.origin}`);
  } else {
    reasons.push(location ? `En ${location}, no en ${flight.origin}` : 'Ubicación desconocida');
  }

  const nearby = countNearbyFlights(flight, memberAssignments);
  score += Math.max(0, MAX_LOAD_POINTS - nearby * POINTS_PER_FLIGHT);
  reasons.push(
    nearby === 0
      ? `Sin vuelos en ${LOAD_WINDOW_HOURS} h`
      : `${nearby} vuelo(s) en ${LOAD_WINDOW_HOURS} h`
  );

  return { score, reasons };
}

module.exports = { scoreCandidate, LOAD_WINDOW_HOURS };
