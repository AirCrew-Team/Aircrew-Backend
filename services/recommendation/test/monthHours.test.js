const { test } = require('node:test');
const assert = require('node:assert/strict');

// Revisión final: el tope de horas del mes es uno solo (100 h, 14 CFR 117.23, de
// @vuelos/shared) y el mes es el local de la base del tripulante, como en Mis Vuelos.
// Verano: el 1 de julio a las 05:00Z es 30 de junio a las 22:00 en Los Ángeles.

const createLoadReplacementContext = require('../src/application/use-cases/loadReplacementContext');
const { monthWindowForDay, buildPlannedFlight } = require('../src/domain/services/crewPlanning');
const { evaluateReplacements } = require('../src/domain/services/replacementRanking');

const ABSENCE_ID = '11111111-1111-4111-8111-111111111111';
const CREW_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
// 1 de junio a medianoche en Los Ángeles: el comienzo del mes local más temprano que
// puede caer en una ventana alrededor del 1 de julio (UTC).
const LAX_JUNE_START = '2026-06-01T07:00:00.000Z';
const LAX_JULY_END = '2026-08-01T07:00:00.000Z';

const EARLY_UTC_JULY = {
  id: 'f1',
  flight_number: 'DL1102',
  origin: 'JFK',
  destination: 'LAX',
  status: 'scheduled',
  departure_at: '2026-07-01T05:00:00Z',
  arrival_at: '2026-07-01T08:00:00Z',
  aircraft_family: 'A320',
  scope: 'domestic',
};

// 98 h voladas en junio (local de cualquier hub).
const june98 = (crewUserId) => ({
  crew_user_id: crewUserId,
  flight: { id: 'junio', flight_number: 'JUNIO', departure_at: '2026-06-02T12:00:00Z', arrival_at: '2026-06-06T14:00:00Z' },
});

test('Revisión: la ventana de asignaciones de un reemplazo cubre el mes local de LAX', async () => {
  const windows = [];
  const loadReplacementContext = createLoadReplacementContext({
    crewClient: {
      async getAbsence() {
        return { id: ABSENCE_ID, crew_user_id: CREW_ID, flight_id: 'f1', status: 'reported' };
      },
      async getCrewMembers() {
        return [];
      },
    },
    flightsClient: {
      async getFlight() {
        return { ...EARLY_UTC_JULY };
      },
      async getAssignments(window) {
        windows.push(window);
        return [];
      },
    },
  });

  await loadReplacementContext(ABSENCE_ID, 'Bearer prueba', { allowCovered: true });

  assert.ok(windows[0].from <= LAX_JUNE_START, `desde ${windows[0].from}`);
  assert.ok(windows[0].to >= LAX_JULY_END, `hasta ${windows[0].to}`);
});

test('Revisión: la ventana de la programación de un día cubre el mes local de cualquier hub', () => {
  // El 1 de julio de Nueva York incluye vuelos que en Los Ángeles son del 30 de junio.
  const window = monthWindowForDay('2026-07-01', 'America/New_York');

  assert.ok(window.from <= LAX_JUNE_START, `desde ${window.from}`);
  assert.ok(window.to >= LAX_JULY_END, `hasta ${window.to}`);
});

test('Revisión: la programación muestra las horas del mes local de la base y el tope de 100 h', () => {
  const plan = {
    ...EARLY_UTC_JULY,
    required_slots: [{ id: 'captain', role: 'captain', accepts: ['captain'], label: 'Comandante' }],
    assignments: [{ slot_id: 'captain', crew_user_id: 'u1', source: 'manual' }],
    crew_status: 'complete',
  };
  const members = [{ user_id: 'u1', employee_code: 'EMP-1', name: 'Ana', rank: 'captain', base_code: 'LAX' }];

  const [slot] = buildPlannedFlight(plan, members, [june98('u1')], 'America/New_York').slots;

  assert.equal(slot.assignee.month_hours, 101);
  assert.equal(slot.assignee.max_month_hours, 100);
});

test('Revisión: el puntaje de reemplazos usa el mes local de la base del candidato', () => {
  const member = (code, base) => ({
    user_id: code,
    employee_code: code,
    rank: 'first_officer',
    ratings: ['A320'],
    medical_expires_on: '2027-12-31',
    is_active: true,
    status: 'available',
    english_level: 5,
    base_code: base,
  });
  // Con 95 h de junio solo cabe en el tope si el vuelo cuenta en julio (JFK).
  const june95 = (crewUserId) => ({
    crew_user_id: crewUserId,
    flight: { id: 'junio', flight_number: 'JUNIO', departure_at: '2026-06-02T12:00:00Z', arrival_at: '2026-06-06T11:00:00Z' },
  });

  const { eligible } = evaluateReplacements({
    members: [member('LAXFO', 'LAX'), member('JFKFO', 'JFK')],
    flight: { ...EARLY_UTC_JULY },
    role: 'first_officer',
    absentUserId: 'nadie',
    assignments: [june95('LAXFO'), june95('JFKFO')],
    now: Date.parse('2026-06-30T12:00:00Z'),
  });

  const byCode = Object.fromEntries(eligible.map((candidate) => [candidate.member.employee_code, candidate.metrics]));
  assert.equal(byCode.LAXFO.month_hours, 95);
  assert.equal(byCode.LAXFO.month_margin_hours, 5);
  assert.equal(byCode.JFKFO.month_hours, 0);
  assert.equal(byCode.JFKFO.month_margin_hours, 100);
});
