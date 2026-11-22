// Tope de horas de vuelo del mes y qué mes es, iguales para crew (Mis Vuelos) y
// recommendation (regla de elegibilidad y puntajes).
const { hubTimezone } = require('./hubs');
const { localDate } = require('./localTime');

// 14 CFR 117.23: máximo 100 horas de vuelo en 672 horas consecutivas. AirCrew lo
// aplica por mes calendario.
const MAX_MONTH_FLIGHT_HOURS = 100;

// Mes (AAAA-MM) de un instante en la zona de la base del tripulante. Sin base, o con
// una que no es un hub, el de Nueva York.
function crewMonth(instant, base) {
  return localDate(instant, hubTimezone(base)).slice(0, 7);
}

module.exports = { MAX_MONTH_FLIGHT_HOURS, crewMonth };
