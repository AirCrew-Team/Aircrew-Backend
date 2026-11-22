const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const createReportAbsence = require('../src/application/use-cases/reportAbsence');
const { flightsWithinDates } = require('../src/domain/entities/absence');

// Opción A: una ausencia por fechas crea una solicitud de reemplazo por cada vuelo
// del tripulante en esas fechas. La ausencia por vuelo sigue funcionando igual.
const NOW = new Date('2026-11-21T15:00:00Z'); // 10:00 en Colombia
const CREW = { id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', role: 'crew' };
const AUTH = 'Bearer tripulante';
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const F3 = '33333333-3333-4333-8333-333333333333';

const assignment = (id, number, departure, extra = {}) => ({
  role: 'first_officer',
  flight: { id, flight_number: number, departure_at: departure, origin: 'BOG', destination: 'MIA', status: 'scheduled', ...extra },
});

// Vuelos de Felipe: uno mañana (en el rango), uno en 5 días (fuera) y uno que ya salió.
const ASSIGNMENTS = [
  assignment(F1, 'AV-8120', '2026-11-22T05:00:00Z'), // 22 nov 00:00 en Colombia
  assignment(F2, 'AV-9000', '2026-11-26T15:00:00Z'),
  assignment(F3, 'AV-7000', '2026-11-21T12:00:00Z'), // hoy, pero ya salió
];

function setup({ flightsFail = false } = {}) {
  const calls = [];
  const state = { absences: [], events: [], suggestions: [], alerts: [] };
  let next = 1;
  const id = () => `00000000-0000-4000-8000-00000000000${next++}`;

  const tx = {
    async hasOverlappingAbsence() { return false; },
    async insertAbsence(input) {
      const row = { id: id(), kind: 'dates', start_date: input.startDate, end_date: input.endDate, reason: input.reason, notes: input.notes, flight_id: null };
      state.absences.push(row);
      return row;
    },
    async insertFlightAbsence(input) {
      calls.push(['insertFlightAbsence', input.flightId, input.parentAbsenceId]);
      const row = { id: id(), kind: 'flight', flight_id: input.flightId, flight_number: input.flightNumber, slot_role: input.slotRole, reason: input.reason, parent_absence_id: input.parentAbsenceId };
      state.absences.push(row);
      return row;
    },
    async insertAttachment() { return null; },
  };

  const absenceRepository = {
    async withCrewMemberLock(userId, fn) { return fn(tx); },
    async createAbsence(input) {
      const row = { id: id(), kind: 'flight', flight_id: input.flightId, flight_number: input.flightNumber, slot_role: input.slotRole, reason: input.reason, parent_absence_id: input.parentAbsenceId || null };
      state.absences.push(row);
      return row;
    },
    async findAbsenceById(absenceId) {
      const row = state.absences.find((a) => a.id === absenceId);
      return row ? { ...row, employee_code: 'AC-0007' } : null;
    },
    async addAbsenceEvent(absenceId, type, text) { state.events.push({ absenceId, type, text }); },
  };

  const reportAbsence = createReportAbsence({
    absenceRepository,
    notificationClient: { async notifyAbsenceReported(absence) { state.alerts.push(absence.id); } },
    flightsClient: {
      async getMyAssignments(auth) {
        calls.push(['getMyAssignments', auth]);
        if (flightsFail) throw new Error('No se pudo consultar el servicio de vuelos.');
        return ASSIGNMENTS;
      },
    },
    recommendationClient: { async requestSuggestions(absenceId) { state.suggestions.push(absenceId); } },
    now: () => NOW,
  });

  return { reportAbsence, calls, state };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Ausencia por fechas → solicitudes de reemplazo', () => {
  it('crea una solicitud por cada vuelo en las fechas, enlazada a la ausencia por fechas', async () => {
    const { reportAbsence, calls } = setup();
    const result = await reportAbsence(CREW, AUTH, { start_date: '2026-11-21', end_date: '2026-11-22', reason: 'fatigue' });

    assert.equal(result.kind, 'dates');
    assert.deepEqual(result.replacement_requests.map((r) => [r.flight_number, r.slot_role, r.parent_absence_id]), [['AV-8120', 'first_officer', result.id]]);
    assert.deepEqual(calls[0], ['getMyAssignments', AUTH]);
  });

  it('pide candidatos a Recommendation para cada solicitud y registra el evento con el código', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { reportAbsence, state } = setup();
    const result = await reportAbsence(CREW, AUTH, { start_date: '2026-11-21', end_date: '2026-11-22', reason: 'fatigue' });
    await settle();

    const requestId = result.replacement_requests[0].id;
    assert.deepEqual(state.suggestions, [requestId]);
    assert.deepEqual(state.events, [{ absenceId: requestId, type: 'reported', text: 'AC-0007 reportó fatiga' }]);
    assert.deepEqual(state.alerts, [result.id]);
  });

  it('sin vuelos en esas fechas, la ausencia queda sin solicitudes', async () => {
    const { reportAbsence, state } = setup();
    const result = await reportAbsence(CREW, AUTH, { start_date: '2026-11-23', end_date: '2026-11-24', reason: 'fatigue' });
    await settle();
    assert.deepEqual(result.replacement_requests, []);
    assert.deepEqual(state.suggestions, []);
  });

  it('si Flights no responde, la ausencia se guarda igual y sin solicitudes', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { reportAbsence } = setup({ flightsFail: true });
    const result = await reportAbsence(CREW, AUTH, { start_date: '2026-11-21', end_date: '2026-11-22', reason: 'fatigue' });
    assert.equal(result.kind, 'dates');
    assert.deepEqual(result.replacement_requests, []);
  });
});

describe('Ausencia por vuelo', () => {
  it('sigue creando la solicitud del vuelo y busca candidatos', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { reportAbsence, state } = setup();
    const result = await reportAbsence(CREW, AUTH, { flight_id: F1, reason: 'illness' });
    await settle();
    assert.equal(result.flight_number, 'AV-8120');
    assert.equal(result.parent_absence_id, null);
    assert.deepEqual(state.suggestions, [result.id]);
  });

  it('rechaza un vuelo que no es suyo o que ya salió', async () => {
    const { reportAbsence } = setup();
    await assert.rejects(reportAbsence(CREW, AUTH, { flight_id: '44444444-4444-4444-8444-444444444444', reason: 'illness' }), { status: 404, code: 'flight_not_assigned' });
    await assert.rejects(reportAbsence(CREW, AUTH, { flight_id: F3, reason: 'illness' }), { status: 409, code: 'flight_departed' });
  });
});

describe('Vuelos dentro de las fechas (hora de Colombia)', () => {
  it('incluye los dos extremos y descarta los que ya salieron o están cancelados', () => {
    const list = [
      ...ASSIGNMENTS,
      assignment('c', 'CANCELADO', '2026-11-22T15:00:00Z', { status: 'cancelled' }),
      assignment('d', 'NOCHE', '2026-11-23T04:59:00Z'), // 22 nov 23:59 en Colombia
    ];
    assert.deepEqual(
      flightsWithinDates(list, '2026-11-21', '2026-11-22', NOW).map((a) => a.flight.flight_number),
      ['AV-8120', 'NOCHE']
    );
  });
});
