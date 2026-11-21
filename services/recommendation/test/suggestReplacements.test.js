const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const createSuggestReplacements = require('../src/application/use-cases/suggestReplacements');

// Caso de uso completo con dependencias falsas: sin base de datos, sin red y sin Claude.
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

const absence = { id: 'abs-1', crew_user_id: 'AUSENTE', flight_number: 'AV-100', reason: 'illness', slot_role: 'first_officer' };
const flight = {
  id: 'f1', flight_number: 'AV-100', origin: 'BOG', destination: 'MDE',
  departure_at: inHours(5), arrival_at: inHours(6), aircraft_family: 'A320', scope: 'domestic',
};
const crew = (id, extra = {}) => ({
  user_id: id, employee_code: id, rank: 'first_officer', ratings: ['A320'], medical_expires_on: '2099-01-01',
  is_active: true, status: 'available', english_level: 5, base_code: 'BOG', ...extra,
});

let calls;
let aiOutput;
let aiError;
let aiEnabled;
let members;
let missed;
let role;

function build() {
  return createSuggestReplacements({
    loadReplacementContext: async () => ({ absence, flight, members, assignments: [], role }),
    ai: {
      model: 'claude-test',
      isEnabled: () => aiEnabled,
      decide: async (input) => {
        calls.ai.push(input);
        if (aiError) throw aiError;
        return { output: aiOutput, model: 'claude-test', inputTokens: 1, outputTokens: 1, durationMs: 1 };
      },
    },
    suggestionRepository: {
      findMissedUserIds: async () => missed,
      saveRound: async (absenceId, suggestions, reason) => {
        calls.saved.push({ absenceId, suggestions, reason });
        return { round: 2, suggestions };
      },
    },
    aiCallRepository: { saveAiCall: async (call) => calls.audit.push(call) },
    crewClient: { updateSuggestionsState: async (id, state, auth) => calls.crew.push({ id, state, auth }) },
    notificationClient: { notifySuggestionsReady: async (payload) => calls.notified.push(payload) },
    serviceAuthorization: () => 'Bearer servicio',
  });
}

const answer = (...ids) => ({
  candidates: ids.map((id) => ({ crew_id: id, affinity: 90, checks: ['Apto'], rationale: `Motivo de ${id}.` })),
  no_candidates_reason: '',
});

beforeEach(() => {
  calls = { ai: [], saved: [], audit: [], crew: [], notified: [] };
  aiOutput = null;
  aiError = null;
  aiEnabled = true;
  members = [crew('OK1'), crew('OK2'), crew('SIN_A320', { ratings: ['787'] }), crew('AUSENTE')];
  missed = [];
  role = 'first_officer';
});

describe('Buscar reemplazos (caso de uso)', () => {
  it('a Claude solo le llegan quienes cumplen las reglas', async () => {
    aiOutput = answer('OK1');
    await build()('abs-1', 'Bearer sup');
    const sent = calls.ai[0].data.candidates.map((c) => c.crew_id);
    assert.deepEqual(sent.sort(), ['OK1', 'OK2']);
  });

  it('guarda solo los que Claude eligió de la lista y avisa con token de servicio', async () => {
    aiOutput = answer('INVENTADO', 'OK2', 'SIN_A320', 'AUSENTE', 'OK1');
    const result = await build()('abs-1', 'Bearer sup');

    assert.deepEqual(result, { state: 'ready', round: 2, candidateCount: 2 });
    const saved = calls.saved[0].suggestions;
    assert.deepEqual(saved.map((s) => [s.crewUserId, s.rankPosition, s.source]), [['OK2', 1, 'ai'], ['OK1', 2, 'ai']]);
    assert.equal(calls.crew[0].state.state, 'ready');
    assert.equal(calls.crew[0].auth, 'Bearer servicio');
    assert.equal(calls.notified[0].candidate_count, 2);
    assert.equal(calls.audit[0].error, null);
  });

  it('si Claude solo propone personas que no cumplen, responde 503 y no guarda nada', async () => {
    aiOutput = answer('SIN_A320', 'AUSENTE');
    await assert.rejects(build()('abs-1', 'Bearer sup'), { status: 503, code: 'ai_unavailable' });
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.crew[0].state.state, 'error');
    assert.match(calls.audit[0].error, /no tenía candidatos válidos/);
  });

  it('si Claude falla, responde 503 y deja el error en la auditoría', async () => {
    aiError = new Error('timeout');
    await assert.rejects(build()('abs-1', 'Bearer sup'), { status: 503, code: 'ai_unavailable' });
    assert.equal(calls.audit[0].error, 'timeout');
    assert.equal(calls.saved.length, 0);
  });

  it('si la IA está desactivada, responde 503 sin llamarla', async () => {
    aiEnabled = false;
    await assert.rejects(build()('abs-1', 'Bearer sup'), { code: 'ai_unavailable' });
    assert.equal(calls.ai.length, 0);
  });

  it('si nadie cumple las reglas, no llama a Claude y queda en "none"', async () => {
    members = [crew('SIN_A320', { ratings: ['787'] })];
    const result = await build()('abs-1', 'Bearer sup', { reason: 'Algo' });
    assert.deepEqual(result, { state: 'none', round: null, candidateCount: 0 });
    assert.equal(calls.ai.length, 0);
    assert.deepEqual(calls.saved[0], { absenceId: 'abs-1', suggestions: [], reason: 'Algo' });
  });

  it('no vuelve a proponer a quien dejó vencer su plazo', async () => {
    missed = ['OK1'];
    aiOutput = answer('OK2');
    await build()('abs-1', 'Bearer sup');
    assert.deepEqual(calls.ai[0].data.candidates.map((c) => c.crew_id), ['OK2']);
  });

  it('el motivo del supervisor llega a Claude como dato y se guarda con la ronda', async () => {
    aiOutput = answer('OK1');
    await build()('abs-1', 'Bearer sup', { reason: 'Preferir guardia' });
    assert.equal(calls.ai[0].data.supervisor_note, 'Preferir guardia');
    assert.equal(calls.saved[0].reason, 'Preferir guardia');
  });

  it('sin motivo, supervisor_note va en null', async () => {
    aiOutput = answer('OK1');
    await build()('abs-1', 'Bearer sup');
    assert.equal(calls.ai[0].data.supervisor_note, null);
    assert.equal(calls.saved[0].reason, null);
  });

  it('si no se sabe el puesto del ausente, responde 409', async () => {
    role = null;
    await assert.rejects(build()('abs-1', 'Bearer sup'), { status: 409, code: 'unknown_slot' });
  });
});
