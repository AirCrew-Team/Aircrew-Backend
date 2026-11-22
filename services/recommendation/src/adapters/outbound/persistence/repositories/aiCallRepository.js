const pool = require('../pool');

// Auditoría de cada decisión: qué se envió a la IA, qué respondió, cuánto
// tardó y el error si no respondió. Si falla guardar la auditoría, la decisión
// sigue adelante: solo se registra el error.
async function saveAiCall({
  kind,
  subjectId,
  model = null,
  request,
  response = null,
  inputTokens = null,
  outputTokens = null,
  durationMs = null,
  usedFallback,
  error = null,
}) {
  try {
    await pool.query(
      `INSERT INTO public.ai_calls
         (kind, subject_id, model, request, response, input_tokens, output_tokens,
          duration_ms, used_fallback, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        kind,
        subjectId,
        model,
        JSON.stringify(request),
        response === null ? null : JSON.stringify(response),
        inputTokens,
        outputTokens,
        durationMs,
        usedFallback,
        error,
      ]
    );
  } catch (cause) {
    console.error(`No se pudo guardar la auditoría de la IA: ${cause.message}`);
  }
}

module.exports = { saveAiCall };
