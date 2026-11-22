const { test } = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('@vuelos/shared');

const createLoadReplacementContext = require('../src/application/use-cases/loadReplacementContext');
const createGetCandidates = require('../src/application/use-cases/getCandidates');
const createRecommendationController = require('../src/adapters/inbound/http/controllers/recommendation.controller');

const NO_FLIGHT_MESSAGE = 'Esta ausencia no tiene un vuelo asociado.';
const ABSENCE_ID = '11111111-1111-4111-8111-111111111111';
const AUTH = 'Bearer token-de-prueba';

// Ausencia por fechas, sin vuelo, como la devuelve Crew.
const ABSENCE = {
  id: ABSENCE_ID,
  crew_user_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  flight_id: null,
  flight_number: null,
  start_date: '2026-11-20',
  end_date: '2026-11-22',
  reason: 'illness',
  status: 'reported',
};

function setup() {
  const flightCalls = [];
  const crewClient = {
    async getAbsence() {
      return { ...ABSENCE };
    },
    async getCrewMembers() {
      return [];
    },
  };
  const flightsClient = {
    async getFlight(id) {
      flightCalls.push(['getFlight', id]);
      throw new Error('No debería pedir el vuelo.');
    },
    async getAssignments() {
      flightCalls.push(['getAssignments']);
      return [];
    },
  };
  const loadReplacementContext = createLoadReplacementContext({ crewClient, flightsClient });
  return { loadReplacementContext, flightCalls, crewClient, flightsClient };
}

test('AU-B10: con una ausencia sin vuelo responde 409 con el mensaje del contrato y no consulta Flights', async () => {
  const { loadReplacementContext, flightCalls } = setup();

  await assert.rejects(loadReplacementContext(ABSENCE_ID, AUTH), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.message, NO_FLIGHT_MESSAGE);
    return true;
  });
  assert.deepEqual(flightCalls, []);
});

test('AU-B10 (HTTP): GET de candidatos responde 409 con { error } para una ausencia sin vuelo', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { crewClient, flightsClient } = setup();
  const suggestionRepository = { async findLatestRound() { return []; } };
  const controller = createRecommendationController({
    getCandidates: createGetCandidates({ crewClient, flightsClient, suggestionRepository }),
  });
  const res = {
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  let failure;

  await controller.listCandidates(
    { params: { id: ABSENCE_ID }, headers: { authorization: AUTH } },
    res,
    (error) => {
      failure = error;
    }
  );
  if (failure) errorHandler(failure, {}, res, () => {});

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: NO_FLIGHT_MESSAGE });
});
