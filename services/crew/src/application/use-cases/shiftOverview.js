const { hubTimezone, localDate, localDayRange } = require('@vuelos/shared');
const {
  currentShift,
  crewMemberShiftState,
  shiftOrder,
  MIN_REST_HOURS,
} = require('../../domain/services/shiftStatus');
const { parseBase } = require('../../domain/value-objects/baseCode');
const { DomainError } = require('../../domain/errors');

const HOUR = 3600000;
// 14 CFR 117.23: máximo 100 horas de vuelo en 672 horas consecutivas (se aplica al mes).
const MAX_MONTH_HOURS = 100;
const REGULATION = 'FAA 14 CFR Part 117';
const monthPattern = /^\d{4}-\d{2}$/;

// Pantallas del turno (supervisor) y métricas de Mis Vuelos (tripulante).
// «Hoy», el turno y el mes van en la zona del hub: la base pedida (?base=) o la
// del tripulante. Sin base, Nueva York.
function createShiftOverview({
  findCrewMembers,
  findCrewMemberByUserId = async () => null,
  absenceRepository,
  attachUserNames,
  flightsClient,
  now: clock = () => Date.now(),
}) {
  async function loadCrew(base, authorization, now) {
    const [members, absences, assignments] = await Promise.all([
      findCrewMembers(),
      absenceRepository.findOpenAbsences(),
      flightsClient.getAssignments(
        { from: new Date(now - 24 * HOUR).toISOString(), to: new Date(now + 24 * HOUR).toISOString() },
        authorization
      ),
    ]);
    const atBase = base ? members.filter((member) => member.base_code === base) : members;
    const named = await attachUserNames(atBase, { user_id: 'name' });
    return named.map((member) =>
      crewMemberShiftState(
        member,
        assignments.filter((item) => item.crew_user_id === member.user_id),
        absences.find((absence) => absence.crew_user_id === member.user_id),
        now
      )
    );
  }

  // Tripulación del turno, ya ordenada (pantalla 3.4).
  async function getShiftCrew({ base } = {}, authorization) {
    const code = parseBase(base);
    const now = clock();
    const members = (await loadCrew(code, authorization, now)).sort(shiftOrder);
    return { base: code, shift: currentShift(now, hubTimezone(code)), members };
  }

  // Banner del inicio: turno, vuelos de hoy y guardia disponible.
  async function getCurrentShift({ base } = {}, authorization) {
    const code = parseBase(base);
    const zone = hubTimezone(code);
    const now = clock();
    const [members, flights] = await Promise.all([
      loadCrew(code, authorization, now),
      flightsClient.listFlights(localDayRange(localDate(now, zone), zone), authorization),
    ]);
    const standby = members.filter((member) => member.status === 'standby');

    return {
      shift: currentShift(now, zone),
      base: code,
      flights_today: flights.filter((flight) => !code || flight.origin === code).length,
      standby_total: standby.length,
      standby_ready: standby.filter((member) => !member.replacement_blocker).length,
      staffing_delays: 0,
    };
  }

  // Métricas de Mis Vuelos: horas del mes (FDP), descanso y sectores.
  async function getMyMetrics(user, authorization, { month } = {}) {
    if (month && !monthPattern.test(month)) {
      throw new DomainError('month debe tener el formato AAAA-MM.', 400, { field: 'month' });
    }

    const now = clock();
    const [member, assignments] = await Promise.all([
      findCrewMemberByUserId(user.id),
      flightsClient.getMyAssignments(authorization),
    ]);
    const zone = hubTimezone(member && member.base);
    const period = month || localDate(now, zone).slice(0, 7);

    const flights = assignments.map((item) => item.flight).filter((flight) => flight.status !== 'cancelled');
    const time = (value) => new Date(value).getTime();
    const inMonth = flights.filter((flight) => localDate(flight.departure_at, zone).slice(0, 7) === period);
    const completed = inMonth.filter((flight) => time(flight.arrival_at) < now);
    const usedHours = inMonth.reduce((total, flight) => total + (time(flight.arrival_at) - time(flight.departure_at)) / HOUR, 0);
    const lastDuty = flights
      .filter((flight) => time(flight.arrival_at) <= now)
      .sort((a, b) => time(b.arrival_at) - time(a.arrival_at))[0];
    const [year, monthNumber] = period.split('-').map(Number);

    return {
      month: period,
      fdp: {
        used_hours: Math.round(usedHours * 10) / 10,
        max_hours: MAX_MONTH_HOURS,
        regulation: REGULATION,
        cycle_closes_on: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
      },
      rest: {
        last_duty_end_at: lastDuty ? lastDuty.arrival_at : null,
        rest_ends_at: lastDuty ? new Date(time(lastDuty.arrival_at) + MIN_REST_HOURS * HOUR).toISOString() : null,
        guaranteed_minutes: MIN_REST_HOURS * 60,
      },
      sectors: {
        completed: completed.length,
        scheduled: inMonth.length - completed.length,
        domestic: completed.filter((flight) => flight.scope !== 'international').length,
        international: completed.filter((flight) => flight.scope === 'international').length,
        crew_delays: 0,
      },
    };
  }

  return { getShiftCrew, getCurrentShift, getMyMetrics };
}

module.exports = createShiftOverview;
