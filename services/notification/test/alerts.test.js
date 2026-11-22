const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createAbsenceReportedAlert,
  createAbsenceCoveredAlert,
} = require('../src/domain/alerts');
const createPublishAlert = require('../src/application/use-cases/publishAlert');

// Ausencia por fechas, sin vuelo, como la manda Crew.
const BY_DATES = {
  id: '11111111-1111-4111-8111-111111111111',
  crew_user_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  employee_code: 'EMP-001',
  flight_id: null,
  flight_number: null,
  flight_departure_at: null,
  start_date: '2026-11-20',
  end_date: '2026-11-22',
  reason: 'illness',
  status: 'reported',
};

const BY_FLIGHT = {
  ...BY_DATES,
  flight_id: '22222222-2222-4222-8222-222222222222',
  flight_number: 'AC201',
  start_date: null,
  end_date: null,
};

test('AU-B9: la alerta de ausencia reportada usa las fechas cuando no hay vuelo', () => {
  const alert = createAbsenceReportedAlert(BY_DATES);

  assert.equal(alert.type, 'absence:reported');
  assert.equal(alert.message, 'EMP-001 no podrá trabajar del 20 nov al 22 nov (incapacidad).');
  assert.equal(alert.absence, BY_DATES);
});

test('AU-B9: las fechas cambian de mes y de año con su abreviatura', () => {
  const alert = createAbsenceReportedAlert({
    ...BY_DATES,
    employee_code: null,
    reason: 'fatigue',
    start_date: '2026-12-30',
    end_date: '2027-01-02',
  });

  assert.equal(alert.message, 'Un tripulante no podrá trabajar del 30 dic al 2 ene (fatiga).');
});

test('AU-B9: publicar la alerta de una ausencia por fechas no falla', () => {
  const published = [];
  const publishAlert = createPublishAlert({
    buildAlert: createAbsenceReportedAlert,
    publisher: {
      publishToSupervisors(alert) {
        published.push(alert);
        return 2;
      },
    },
  });

  const result = publishAlert({ absence: BY_DATES });

  assert.deepEqual(result, {
    type: 'absence:reported',
    message: 'EMP-001 no podrá trabajar del 20 nov al 22 nov (incapacidad).',
    delivered_to: 2,
  });
  assert.equal(published.length, 1);
});

test('AU-B9: la alerta de ausencia por vuelo conserva su texto', () => {
  const alert = createAbsenceReportedAlert(BY_FLIGHT);

  assert.equal(alert.message, 'EMP-001 no podrá volar AC201 (incapacidad).');
});

test('AU-B9: la alerta de «cubierta» usa las fechas cuando no hay vuelo', () => {
  const alert = createAbsenceCoveredAlert({ ...BY_DATES, status: 'covered' });

  assert.equal(alert.type, 'absence:covered');
  assert.equal(
    alert.message,
    'La ausencia de EMP-001 del 20 nov al 22 nov ya tiene reemplazo.'
  );
});

test('AU-B9: la alerta de «cubierta» por vuelo conserva su texto', () => {
  const alert = createAbsenceCoveredAlert({ ...BY_FLIGHT, status: 'covered' });

  assert.equal(alert.message, 'La ausencia del vuelo AC201 ya tiene reemplazo.');
});

for (const [label, absence] of [
  ['sin vuelo ni fechas', { ...BY_DATES, start_date: null, end_date: null }],
  ['con una fecha que no es AAAA-MM-DD', { ...BY_DATES, end_date: '22/11/2026' }],
  ['sin id', { ...BY_DATES, id: undefined }],
]) {
  test(`AU-B9: rechaza con 400 una ausencia ${label}`, () => {
    assert.throws(
      () => createAbsenceReportedAlert(absence),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(
          error.message,
          'Se requiere una ausencia con id y flight_number o con start_date y end_date.'
        );
        return true;
      }
    );
  });
}
