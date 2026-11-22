const {
  currentShift,
  crewMemberShiftState,
  shiftOrder,
  MIN_REST_HOURS,
} = require('../../domain/services/shiftStatus');
const { DomainError } = require('../../domain/errors');

const HOUR = 3600000;
const MAX_MONTH_HOURS = 90;
const basePattern = /^[A-Z]{3}$/;
const monthPattern = /^\d{4}-\d{2}$/;

function bogotaDay(now) {
  const from = new Date(new Date(now - 5 * HOUR).toISOString().slice(0, 10) + 'T05:00:00.000Z');
  return { from: from.toISOString(), to: new Date(from.getTime() + 24 * HOUR).toISOString() };
}

function parseBase(base) {
  if (base === undefined || base === '') return null;
  const code = String(base).toUpperCase();
  if (!basePattern.test(code)) {
    throw new DomainError('base debe ser un código IATA de 3 letras, por ejemplo BOG.', 400, { field: 'base' });
  }
  return code;
}

// Pantallas del turno (supervisor) y métricas de Mis Vuelos (tripulante).
function createShiftOverview({ findCrewMembers, absenceRepository, attachUserNames, flightsClient }) {
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
    const now = Date.now();
    const members = (await loadCrew(code, authorization, now)).sort(shiftOrder);
    return { base: code, shift: currentShift(now), members };
  }

  // Banner del inicio: turno, vuelos de hoy y guardia disponible.
  async function getCurrentShift({ base } = {}, authorization) {
    const code = parseBase(base);
    const now = Date.now();
    const [members, flights] = await Promise.all([
      loadCrew(code, authorization, now),
      flightsClient.listFlights(bogotaDay(now), authorization),
    ]);
    const standby = members.filter((member) => member.status === 'standby');

    return {
      shift: currentShift(now),
      base: code,
      flights_today: flights.filter((flight) => !code || flight.origin === code).length,
      standby_total: standby.length,
      standby_ready: standby.filter((member) => !member.replacement_blocker).length,
      staffing_delays: 0,
    };
  }

  // Métricas de Mis Vuelos: horas del mes (FDP), descanso y sectores.
  async function getMyMetrics(user, authorization, { month } = {}) {
    const now = Date.now();
    const period = month || new Date(now - 5 * HOUR).toISOString().slice(0, 7);
    if (!monthPattern.test(period)) {
      throw new DomainError('month debe tener el formato AAAA-MM.', 400, { field: 'month' });
    }

    const assignments = await flightsClient.getMyAssignments(authorization);
    const flights = assignments.map((item) => item.flight).filter((flight) => flight.status !== 'cancelled');
    const time = (value) => new Date(value).getTime();
    const inMonth = flights.filter((flight) => new Date(flight.departure_at).toISOString().slice(0, 7) === period);
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
        regulation: 'RAC 3',
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
