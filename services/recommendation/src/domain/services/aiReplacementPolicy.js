// Qué se le pide a Claude para ordenar reemplazos y cómo se valida su respuesta.
// No llama a la IA: define el contrato. Así las reglas del negocio (qué datos
// se envían, qué se acepta) quedan en el dominio y no en el adaptador.

const MIN_RESULTS = 3;
const MAX_RESULTS = 5;

const REPLACEMENT_SYSTEM_PROMPT = `Eres el asistente de operaciones de vuelo de AirCrew.
Un tripulante no podrá cumplir un vuelo y hay que proponer reemplazos para su mismo puesto.

Todos los candidatos que recibes YA CUMPLEN las reglas de seguridad (rango, habilitación,
certificado médico, descanso, horas del mes, inglés). No decides si alguien puede volar:
solo ordenas a los mejores y explicas por qué.

Ordena de ${MIN_RESULTS} a ${MAX_RESULTS} candidatos (o todos, si hay menos) con estos criterios, en este orden:
1. Que llegue a tiempo: de guardia y pocos minutos a la rampa frente al tiempo hasta la salida.
2. Seguridad: más horas de descanso antes del vuelo y más margen de horas en el mes.
3. Experiencia en el avión y la ruta.
4. Reparto justo: no cargar siempre a los mismos.

Para cada uno devuelve:
- crew_id: exactamente el que recibiste.
- affinity: de 0 a 100 (90 o más = óptimo).
- checks: de 3 a 5 frases muy cortas en español con los datos que lo hacen apto.
- rationale: 1 a 3 frases en español que expliquen por qué va en ese lugar frente a los demás,
  citando datos concretos (minutos, horas, habilitación). No inventes datos.

Si hay candidatos, deja no_candidates_reason como texto vacío. Si no hay, devuelve candidates
vacío y explica el motivo en no_candidates_reason.`;

const REPLACEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates', 'no_candidates_reason'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['crew_id', 'affinity', 'checks', 'rationale'],
        properties: {
          crew_id: { type: 'string' },
          affinity: { type: 'integer' },
          checks: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
      },
    },
    // Texto vacío cuando sí hay candidatos.
    no_candidates_reason: { type: 'string' },
  },
};

// Datos mínimos para decidir: sin correos, teléfonos ni detalles médicos.
function buildReplacementRequest({ absence, flight, candidates, now = Date.now() }) {
  return {
    absence: {
      reason: absence.reason,
      slot_role: absence.slot_role,
    },
    flight: {
      flight_number: flight.flight_number,
      route: `${flight.origin}-${flight.destination}`,
      scope: flight.scope,
      aircraft_family: flight.aircraft_family,
      departure_at: flight.departure_at,
      minutes_to_departure: Math.round((new Date(flight.departure_at).getTime() - now) / 60000),
    },
    candidates: candidates.map((candidate) => ({
      crew_id: candidate.member.user_id,
      rank: candidate.member.rank,
      base: candidate.member.base_code,
      on_standby: candidate.metrics.tier === 'standby',
      minutes_to_ramp: candidate.metrics.minutes_to_ramp,
      month_hours: candidate.metrics.month_hours,
      month_margin_hours: candidate.metrics.month_margin_hours,
      rest_hours_before: candidate.metrics.rest_hours_before,
      english_level: candidate.member.english_level,
      ratings: candidate.member.ratings,
      rule_score: candidate.score,
    })),
  };
}

// Acepta solo crew_id que estaban en la lista enviada, sin repetir, con
// affinity entre 0 y 100. Devuelve null si no queda ninguno válido.
function validateReplacementOutput(output, candidates) {
  const allowed = new Map(candidates.map((candidate) => [candidate.member.user_id, candidate]));
  const seen = new Set();
  const valid = [];

  for (const item of (output && output.candidates) || []) {
    const candidate = allowed.get(item.crew_id);
    if (!candidate || seen.has(item.crew_id)) continue;
    if (!Number.isInteger(item.affinity) || item.affinity < 0 || item.affinity > 100) continue;
    if (typeof item.rationale !== 'string' || !item.rationale.trim()) continue;

    seen.add(item.crew_id);
    valid.push({
      candidate,
      affinity: item.affinity,
      checks: (Array.isArray(item.checks) ? item.checks : [])
        .filter((check) => typeof check === 'string' && check.trim())
        .slice(0, 5),
      rationale: item.rationale.trim(),
    });

    if (valid.length === MAX_RESULTS) break;
  }

  return valid.length > 0 ? valid : null;
}

module.exports = {
  REPLACEMENT_SYSTEM_PROMPT,
  REPLACEMENT_SCHEMA,
  buildReplacementRequest,
  validateReplacementOutput,
  MAX_RESULTS,
};
