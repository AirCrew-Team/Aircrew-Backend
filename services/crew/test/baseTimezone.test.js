const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// BE-4 (D8): «hoy», el turno y los días de una ausencia se calculan en la zona del
// hub (la base pedida, la del tripulante o la del supervisor). Sin base, Nueva York.
// Fechas de verano a propósito: en noviembre Nueva York (−5) coincide con Bogotá.
const { currentShift } = require('../src/domain/services/shiftStatus');
const { flightsWithinDates } = require('../src/domain/entities/absence');
const createShiftOverview = require('../src/application/use-cases/shiftOverview');
const createReportAbsence = require('../src/application/use-cases/reportAbsence');
const createAbsenceWorkflow = require('../src/application/use-cases/absenceWorkflow');
const pool = require('../src/adapters/outbound/persistence/pool');
const absenceRepository = require('../src/adapters/outbound/persistence/repositories/absenceRepository');

const CREW = { id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', role: 'crew' };

describe('Turno en la zona de la base', () => {
  // 18:30Z de julio: 14:30 en Nueva York (EDT) y 11:30 en Los Ángeles (PDT).
  const AFTERNOON_NY = Date.parse('2026-07-15T18:30:00Z');
  // 02:30Z: 22:30 del día anterior en Nueva York y 19:30 en Los Ángeles.
  const NIGHT_NY = Date.parse('2026-07-16T02:30:00Z');

  it('el mismo instante es un turno distinto en JFK y en LAX', () => {
    assert.equal(currentShift(AFTERNOON_NY, 'America/New_York'), 'afternoon');
    assert.equal(currentShift(AFTERNOON_NY, 'America/Los_Angeles'), 'morning');
    assert.equal(currentShift(NIGHT_NY, 'America/New_York'), 'night');
    assert.equal(currentShift(NIGHT_NY, 'America/Los_Angeles'), 'afternoon');
  });

  it('sin zona usa Nueva York, con su horario de verano', () => {
    assert.equal(currentShift(AFTERNOON_NY), 'afternoon');
  });
});

function shiftSetup({ now, member = null, flights = [], assignments = [] } = {}) {
  const calls = { listFlights: [], findCrewMemberByUserId: [] };
  const overview = createShiftOverview({
    findCrewMembers: async () => [],
    findCrewMemberByUserId: async (userId) => {
      calls.findCrewMemberByUserId.push(userId);
      return member;
    },
    absenceRepository: { findOpenAbsences: async () => [] },
    attachUserNames: async (rows) => rows,
    flightsClient: {
      getAssignments: async () => [],
      getMyAssignments: async () => assignments,
      listFlights: async (range) => {
        calls.listFlights.push(range);
        return flights;
      },
    },
    now: () => now,
  });
  return { overview, calls };
}

describe('Banner del turno: vuelos de hoy en la zona de la base', () => {
  // 2026-07-16 05:00Z: ya es 16 en Nueva York (01:00) y todavía 15 en Los Ángeles (22:00).
  const NOW = Date.parse('2026-07-16T05:00:00Z');

  it('con base LAX pide el día local de Los Ángeles y el turno sale en su hora', async () => {
    const { overview, calls } = shiftSetup({ now: NOW });
    const result = await overview.getCurrentShift({ base: 'lax' }, 'Bearer sup');

    assert.deepEqual(calls.listFlights[0], {
      from: '2026-07-15T07:00:00.000Z',
      to: '2026-07-16T07:00:00.000Z',
    });
    assert.equal(result.base, 'LAX');
    assert.equal(result.shift, 'night'); // 22:00 en Los Ángeles
  });

  it('con base JFK pide el día local de Nueva York', async () => {
    const { overview, calls } = shiftSetup({ now: NOW });
    await overview.getCurrentShift({ base: 'JFK' }, 'Bearer sup');

    assert.deepEqual(calls.listFlights[0], {
      from: '2026-07-16T04:00:00.000Z',
      to: '2026-07-17T04:00:00.000Z',
    });
  });

  it('sin base (super_admin) usa Nueva York', async () => {
    const { overview, calls } = shiftSetup({ now: NOW });
    await overview.getCurrentShift({}, 'Bearer admin');
    assert.equal(calls.listFlights[0].from, '2026-07-16T04:00:00.000Z');
  });

  it('la lista del turno también usa la hora de la base', async () => {
    const { overview } = shiftSetup({ now: NOW });
    assert.equal((await overview.getShiftCrew({ base: 'LAX' }, 'Bearer sup')).shift, 'night');
    assert.equal((await overview.getShiftCrew({ base: 'JFK' }, 'Bearer sup')).shift, 'night');
    const morning = shiftSetup({ now: Date.parse('2026-07-16T13:30:00Z') }).overview; // 09:30 NY · 06:30 LA
    assert.equal((await morning.getShiftCrew({ base: 'SEA' }, 'Bearer sup')).shift, 'morning');
  });

  it('una base que no es un código IATA sigue dando 400', async () => {
    const { overview } = shiftSetup({ now: NOW });
    await assert.rejects(overview.getCurrentShift({ base: 'bogota' }, 'Bearer sup'), { status: 400, field: 'base' });
  });
});

describe('Métricas de Mis Vuelos en la zona del tripulante', () => {
  // 2026-08-01 05:00Z: 31 de julio a las 22:00 en Los Ángeles, 1 de agosto en Nueva York.
  const NOW = Date.parse('2026-08-01T05:00:00Z');
  const flight = (departure, arrival) => ({
    flight: { departure_at: departure, arrival_at: arrival, status: 'scheduled', scope: 'domestic' },
  });
  // Sale a las 05:30Z del 1 de agosto: 22:30 del 31 de julio en Los Ángeles y
  // 01:30 del 1 de agosto en Nueva York. Todavía no ha salido (programado).
  const LATE = flight('2026-08-01T05:30:00Z', '2026-08-01T08:30:00Z');

  it('el mes por defecto y el mes de cada vuelo salen en la zona de su base', async () => {
    const { overview, calls } = shiftSetup({ now: NOW, member: { base: 'LAX', base_code: 'LAX' }, assignments: [LATE] });
    const metrics = await overview.getMyMetrics(CREW, 'Bearer crew');

    assert.deepEqual(calls.findCrewMemberByUserId, [CREW.id]);
    assert.equal(metrics.month, '2026-07');
    assert.equal(metrics.sectors.scheduled, 1);
    assert.equal(metrics.fdp.used_hours, 3);
  });

  it('sin perfil o sin base, Nueva York: el mes ya es agosto y el vuelo también', async () => {
    const { overview } = shiftSetup({ now: NOW, member: null, assignments: [LATE] });
    const metrics = await overview.getMyMetrics(CREW, 'Bearer crew');
    assert.equal(metrics.month, '2026-08');
    assert.equal(metrics.sectors.scheduled, 1);
    const july = await overview.getMyMetrics(CREW, 'Bearer crew', { month: '2026-07' });
    assert.equal(july.sectors.scheduled, 0);
  });

  it('la normativa del FDP es la de la FAA, no la RAC', async () => {
    const { overview } = shiftSetup({ now: NOW });
    const metrics = await overview.getMyMetrics(CREW, 'Bearer crew');
    assert.equal(metrics.fdp.regulation, 'FAA 14 CFR Part 117');
  });
});

describe('Ausencia por fechas: los días son los de la zona del tripulante', () => {
  const NOW = new Date('2026-07-14T15:00:00Z');
  const assignment = (id, departure) => ({
    role: 'first_officer',
    flight: { id, flight_number: id, departure_at: departure, origin: 'LAX', destination: 'JFK', status: 'scheduled' },
  });
  // 15 de julio a las 23:30 en Los Ángeles = 16 de julio a las 02:30 en Nueva York.
  const LATE = assignment('DL-LATE', '2026-07-16T06:30:00Z');

  it('flightsWithinDates usa la zona que recibe', () => {
    assert.deepEqual(flightsWithinDates([LATE], '2026-07-15', '2026-07-15', NOW, 'America/Los_Angeles').length, 1);
    assert.deepEqual(flightsWithinDates([LATE], '2026-07-15', '2026-07-15', NOW, 'America/New_York').length, 0);
    assert.deepEqual(flightsWithinDates([LATE], '2026-07-15', '2026-07-15', NOW).length, 0); // Nueva York
  });

  function reportSetup(member) {
    const inserted = [];
    const tx = {
      async hasOverlappingAbsence() { return false; },
      async insertAbsence(input) { return { id: 'a1', kind: 'dates', start_date: input.startDate, end_date: input.endDate }; },
      async insertAttachment() { return null; },
      async insertFlightAbsence(input) { inserted.push(input.flightNumber); return { id: `r-${input.flightNumber}`, reason: input.reason }; },
    };
    const reportAbsence = createReportAbsence({
      absenceRepository: {
        withCrewMemberLock: async (_userId, work) => work(tx),
        findAbsenceById: async () => null,
        addAbsenceEvent: async () => {},
      },
      notificationClient: { notifyAbsenceReported: async () => {} },
      flightsClient: { getMyAssignments: async () => [LATE] },
      findCrewMemberByUserId: async () => member,
      now: () => NOW,
    });
    return { reportAbsence, inserted };
  }

  it('un tripulante de LAX que falta el 15 deja libre el vuelo de las 23:30 de Los Ángeles', async () => {
    const { reportAbsence, inserted } = reportSetup({ base: 'LAX', base_code: 'LAX' });
    await reportAbsence(CREW, 'Bearer crew', { start_date: '2026-07-15', end_date: '2026-07-15', reason: 'fatigue' });
    assert.deepEqual(inserted, ['DL-LATE']);
  });

  it('uno de JFK que falta el 15 no: para él ese vuelo es del 16', async () => {
    const { reportAbsence, inserted } = reportSetup({ base: 'JFK', base_code: 'JFK' });
    await reportAbsence(CREW, 'Bearer crew', { start_date: '2026-07-15', end_date: '2026-07-15', reason: 'fatigue' });
    assert.deepEqual(inserted, []);
  });
});

describe('Seguimiento e indicadores del turno en la zona de la base', () => {
  // 2026-07-16 05:00Z: 22:00 del 15 en Los Ángeles, 01:00 del 16 en Nueva York.
  const NOW = new Date('2026-07-16T05:00:00Z');

  function workflowSetup() {
    const calls = { byDay: [], stats: [] };
    const workflow = createAbsenceWorkflow({
      absenceRepository: {
        findAbsencesByDepartureDay: async (...args) => { calls.byDay.push(args); return []; },
        findEventsByAbsences: async () => [],
        getAbsenceStats: async (...args) => {
          calls.stats.push(args);
          return { reported: 0, pending_ack: 0, covered_today: 0, covered_30d: 0, total_30d: 0 };
        },
      },
      attachUserNames: async (rows) => rows,
      notificationClient: {},
      now: () => NOW,
    });
    return { workflow, calls };
  }

  it('sin fecha, «hoy» es el de la base; el día se agrupa en su zona', async () => {
    const { workflow, calls } = workflowSetup();
    await workflow.getTracking({ base: 'LAX' });
    await workflow.getTracking({ base: 'JFK' });
    await workflow.getTracking({ date: '2026-07-20', base: 'SEA' });
    await workflow.getTracking({});
    assert.deepEqual(calls.byDay, [
      ['2026-07-15', 'America/Los_Angeles'],
      ['2026-07-16', 'America/New_York'],
      ['2026-07-20', 'America/Los_Angeles'],
      ['2026-07-16', 'America/New_York'],
    ]);
  });

  it('«cubiertas hoy» se cuenta en la zona de la base', async () => {
    const { workflow, calls } = workflowSetup();
    await workflow.getStats({ base: 'LAX' });
    await workflow.getStats();
    assert.deepEqual(calls.stats, [
      ['2026-07-16T05:00:00.000Z', 'America/Los_Angeles'],
      ['2026-07-16T05:00:00.000Z', 'America/New_York'],
    ]);
  });

  it('una base que no es un código IATA da 400', async () => {
    const { workflow } = workflowSetup();
    await assert.rejects(workflow.getTracking({ base: 'L1' }), { status: 400, field: 'base' });
    await assert.rejects(workflow.getStats({ base: 'bogota' }), { status: 400, field: 'base' });
  });

  it('el repositorio convierte las fechas con la zona recibida, sin zona fija', async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{}] };
    });

    await absenceRepository.findAbsencesByDepartureDay('2026-07-15', 'America/Los_Angeles');
    await absenceRepository.getAbsenceStats('2026-07-16T05:00:00.000Z', 'America/Los_Angeles');

    for (const { sql, params } of queries) {
      assert.doesNotMatch(sql, /Bogota/);
      assert.match(sql, /AT TIME ZONE \$2/);
      assert.equal(params[1], 'America/Los_Angeles');
    }
  });
});
