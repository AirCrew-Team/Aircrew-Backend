// Fecha y hora locales de un instante en una zona IANA (p. ej. America/Los_Angeles).
// Se calculan con Intl, nunca con un desfase fijo: EE. UU. tiene horario de verano.

const formatters = new Map();

function partsIn(instant, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
    );
  }
  const parts = {};
  for (const { type, value } of formatters.get(timeZone).formatToParts(new Date(instant))) {
    parts[type] = value;
  }
  return parts;
}

// Día local (AAAA-MM-DD) de un instante (Date, milisegundos o texto ISO).
function localDate(instant, timeZone) {
  const { year, month, day } = partsIn(instant, timeZone);
  return `${year}-${month}-${day}`;
}

// Hora local (0 a 23) de un instante.
function localHour(instant, timeZone) {
  return Number(partsIn(instant, timeZone).hour);
}

// Diferencia entre la hora de la zona y UTC en ese instante, en milisegundos.
function zoneOffset(instant, timeZone) {
  const { year, month, day, hour, minute, second } = partsIn(instant, timeZone);
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// Instante UTC de la medianoche local de un día AAAA-MM-DD. Dos pasadas: la
// segunda corrige si el desfase cambia entre la estimación y la medianoche.
function localMidnight(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall - zoneOffset(wall, timeZone);
  instant = wall - zoneOffset(instant, timeZone);
  return instant;
}

function nextDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// Rango UTC [from, to) de un día local. Cada medianoche se calcula aparte: el
// día del cambio de horario dura 23 o 25 h.
function localDayRange(date, timeZone) {
  return {
    from: new Date(localMidnight(date, timeZone)).toISOString(),
    to: new Date(localMidnight(nextDate(date), timeZone)).toISOString(),
  };
}

module.exports = { localDate, localHour, localDayRange };
