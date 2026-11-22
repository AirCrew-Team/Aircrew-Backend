// Plazo para que el reemplazo confirme con «Enterado»: 30 minutos, o la mitad
// del tiempo que falta para la salida si eso es menor (un vuelo que sale
// pronto no puede esperar media hora una respuesta).
const MAX_DEADLINE_MINUTES = 30;
const MIN_DEADLINE_MINUTES = 5;

function acknowledgementDeadline(departureAt, now = Date.now()) {
  const untilDeparture = new Date(departureAt).getTime() - now;
  const minutes = Math.max(
    MIN_DEADLINE_MINUTES,
    Math.min(MAX_DEADLINE_MINUTES, Math.floor(untilDeparture / 2 / 60000))
  );

  return new Date(now + minutes * 60000).toISOString();
}

module.exports = { acknowledgementDeadline, MAX_DEADLINE_MINUTES };
