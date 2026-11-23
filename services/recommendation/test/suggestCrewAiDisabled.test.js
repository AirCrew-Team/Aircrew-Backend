const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const createCrewScheduling = require('../src/application/use-cases/crewScheduling');

// Sugerir tripulación con la IA sin configurar: dependencias falsas, sin Claude.
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const reason = 'La IA no está configurada: falta CLAUDE_CODE_OAUTH_TOKEN.';

const plan = {
  id: 'f1', flight_number: 'AV-100', origin: 'BOG', destination: 'MDE',
  departure_at: inHours(30), arrival_at: inHours(31), aircraft_family: 'A320', scope: 'domestic',
  required_slots: [{ id: 'fo', label: 'Primer oficial', role: 'first_officer', accepts: ['first_officer'] }],
  assignments: [],
};
const member = {
  user_id: 'OK1', employee_code: 'OK1', rank: 'first_officer', ratings: ['A320'], medical_expires_on: '2099-01-01',
  is_active: true, status: 'available', english_level: 5, base_code: 'BOG',
};

describe('Sugerir tripulación sin IA configurada', () => {
  it('responde 503 con el motivo, sin llamar a Claude, y lo deja en la auditoría', async () => {
    const audit = [];
    let decided = 0;
    const scheduling = createCrewScheduling({
      flightsClient: { getCrewPlan: async () => plan, getAssignments: async () => [] },
      crewClient: { getCrewMembers: async () => [member] },
      ai: {
        model: null,
        isEnabled: () => false,
        disabledReason: reason,
        decide: async () => {
          decided += 1;
        },
      },
      aiCallRepository: { saveAiCall: async (call) => audit.push(call) },
      serviceAuthorization: () => 'Bearer servicio',
    });

    await assert.rejects(scheduling.suggestCrew('f1', 'Bearer sup'), { status: 503, code: 'ai_unavailable', message: reason });
    assert.equal(decided, 0);
    assert.equal(audit[0].error, reason);
  });
});
