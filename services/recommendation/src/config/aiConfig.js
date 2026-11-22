// IA (Claude). Dos proveedores, con el mismo contrato:
// - claude_code: ejecuta Claude Code (`claude -p`) con la suscripción de quien
//   corre el backend: el token de suscripción de Claude Code en
//   CLAUDE_CODE_OAUTH_TOKEN. Sin él, la IA queda apagada (no se usa la sesión
//   iniciada en el equipo).
// - api: usa la API de Anthropic con ANTHROPIC_API_KEY (saldo de la API).
// Si la IA está apagada o falla, las recomendaciones y sugerencias responden
// 503 (no hay orden de respaldo). disabledReason dice por qué está apagada.
function disabledReasonFor(env, provider) {
  if (env.AI_ENABLED === 'false') return 'La IA está desactivada (AI_ENABLED=false).';
  const required = provider === 'claude_code' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
  if (!String(env[required] || '').trim()) return `La IA no está configurada: falta ${required}.`;
  return null;
}

function aiConfig(env) {
  const provider = env.AI_PROVIDER === 'claude_code' ? 'claude_code' : 'api';
  const disabledReason = disabledReasonFor(env, provider);
  return {
    provider,
    enabled: disabledReason === null,
    disabledReason,
    model: env.CLAUDE_MODEL || (provider === 'api' ? 'claude-opus-5-5' : null),
    // Claude Code tarda más: arranca un proceso nuevo en cada llamada.
    timeoutMs: Number(env.AI_TIMEOUT_MS) || (provider === 'claude_code' ? 90000 : 20000),
    // Opcional: sin ella se usa el binario del paquete instalado (ver claudeCodeClient).
    claudeCodePath: env.CLAUDE_CODE_PATH || null,
  };
}

module.exports = { aiConfig };
