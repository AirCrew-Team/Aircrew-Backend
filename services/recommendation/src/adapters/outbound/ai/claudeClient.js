const Anthropic = require('@anthropic-ai/sdk');
const { ai } = require('../../../config/env');

// Adaptador de salida hacia Claude. Recibe un prompt de sistema fijo, los datos
// de la decisión y un JSON Schema; devuelve el JSON que respondió Claude.
// Cualquier problema (sin API key, tiempo agotado, rechazo, respuesta cortada
// o JSON inválido) se lanza como error y el caso de uso lo informa.
let client = null;

function getClient() {
  if (!client) {
    // La API key la lee el SDK de ANTHROPIC_API_KEY.
    client = new Anthropic({ timeout: ai.timeoutMs, maxRetries: 0 });
  }
  return client;
}

function isEnabled() {
  return ai.enabled;
}

async function decide({ system, data, schema, effort = 'medium' }) {
  if (!ai.enabled) {
    throw new Error(ai.disabledReason);
  }

  const started = Date.now();
  const response = await getClient().beta.messages.create({
    model: ai.model,
    max_tokens: 4000,
    // Si el modelo rechaza la solicitud, el servidor la reintenta con otro modelo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // El prompt de sistema no cambia entre llamadas: se cachea y sale más barato.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(data) }],
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude rechazó la solicitud.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('La respuesta de Claude quedó cortada.');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return {
    output: JSON.parse(text),
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    durationMs: Date.now() - started,
  };
}

module.exports = { decide, isEnabled, disabledReason: ai.disabledReason, model: ai.model };
