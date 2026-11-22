const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { aiConfig } = require('../src/config/aiConfig');

// Se pasa un entorno explícito: process.env del test trae el .env local.
describe('Configuración de la IA', () => {
  it('claude_code con el token de suscripción queda activa', () => {
    const ai = aiConfig({ AI_PROVIDER: 'claude_code', CLAUDE_CODE_OAUTH_TOKEN: 'token' });
    assert.equal(ai.provider, 'claude_code');
    assert.equal(ai.enabled, true);
    assert.equal(ai.disabledReason, null);
  });

  it('claude_code sin CLAUDE_CODE_OAUTH_TOKEN queda apagada y dice qué falta', () => {
    const ai = aiConfig({ AI_PROVIDER: 'claude_code' });
    assert.equal(ai.enabled, false);
    assert.equal(ai.disabledReason, 'La IA no está configurada: falta CLAUDE_CODE_OAUTH_TOKEN.');
  });

  it('un token vacío o con solo espacios cuenta como ausente', () => {
    assert.equal(aiConfig({ AI_PROVIDER: 'claude_code', CLAUDE_CODE_OAUTH_TOKEN: '  ' }).enabled, false);
  });

  it('AI_ENABLED=false la apaga aunque haya token', () => {
    const ai = aiConfig({ AI_PROVIDER: 'claude_code', CLAUDE_CODE_OAUTH_TOKEN: 'token', AI_ENABLED: 'false' });
    assert.equal(ai.enabled, false);
    assert.equal(ai.disabledReason, 'La IA está desactivada (AI_ENABLED=false).');
  });

  it('api sin ANTHROPIC_API_KEY queda apagada y dice qué falta', () => {
    const ai = aiConfig({});
    assert.equal(ai.provider, 'api');
    assert.equal(ai.enabled, false);
    assert.equal(ai.disabledReason, 'La IA no está configurada: falta ANTHROPIC_API_KEY.');
  });

  it('api con ANTHROPIC_API_KEY queda activa', () => {
    assert.equal(aiConfig({ ANTHROPIC_API_KEY: 'clave' }).enabled, true);
  });

  it('CLAUDE_CODE_PATH es opcional: sin él no hay ruta fija', () => {
    assert.equal(aiConfig({ AI_PROVIDER: 'claude_code' }).claudeCodePath, null);
    assert.equal(aiConfig({ CLAUDE_CODE_PATH: '/opt/claude' }).claudeCodePath, '/opt/claude');
  });

  it('mantiene los valores por defecto de modelo y tiempo de espera', () => {
    assert.deepEqual(
      [aiConfig({ AI_PROVIDER: 'claude_code' }).model, aiConfig({ AI_PROVIDER: 'claude_code' }).timeoutMs],
      [null, 90000]
    );
    assert.deepEqual([aiConfig({}).model, aiConfig({}).timeoutMs], ['claude-opus-5-5', 20000]);
    assert.equal(aiConfig({ CLAUDE_MODEL: 'sonnet', AI_TIMEOUT_MS: '5000' }).timeoutMs, 5000);
  });
});
