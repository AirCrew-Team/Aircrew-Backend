// Un instante en el tiempo. Exige ISO-8601 con zona horaria explícita
// (Z o ±hh:mm) para que no haya dudas de qué hora es; se guarda en UTC.
const isoWithZonePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value) {
  if (typeof value !== 'string' || !isoWithZonePattern.test(value)) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = { parseInstant };
