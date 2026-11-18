const HOUR_MS = 60 * 60 * 1000;
const MIN_REST_HOURS = 10;

// Descanso: entre otro vuelo del tripulante y este debe haber al menos
// MIN_REST_HOURS antes de la salida y después de la llegada.
const restRule = {
  name: 'rest',

  check({ flight, memberAssignments }) {
    const restStart = new Date(flight.departure_at).getTime() - MIN_REST_HOURS * HOUR_MS;
    const restEnd = new Date(flight.arrival_at).getTime() + MIN_REST_HOURS * HOUR_MS;

    const conflict = memberAssignments.find(
      ({ flight: other }) =>
        other.id !== flight.id &&
        new Date(other.departure_at).getTime() < restEnd &&
        new Date(other.arrival_at).getTime() > restStart
    );

    if (conflict) {
      return `No cumple ${MIN_REST_HOURS} h de descanso: tiene el vuelo ${conflict.flight.flight_number}.`;
    }

    return null;
  },
};

module.exports = { restRule, MIN_REST_HOURS };
