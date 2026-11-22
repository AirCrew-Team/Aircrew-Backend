// Contrato con Claude para sugerir la tripulación de un vuelo: qué se envía,
// qué se le pide y cómo se valida la respuesta. No llama a la IA.

const MAX_PER_SLOT = 8;

const SCHEDULE_SYSTEM_PROMPT = `Eres el asistente de programación de tripulaciones de AirCrew.
Debes proponer quién ocupa cada puesto vacío de un vuelo.

Todos los candidatos que recibes para cada puesto YA CUMPLEN las reglas de seguridad (rango,
habilitación, certificado médico, descanso, horas del mes, inglés). No decides si alguien puede
volar: eliges al mejor para cada puesto y explicas por qué.

Reglas para elegir:
- Una persona solo puede ocupar UN puesto en este vuelo.
- Reparte la carga: prefiere a quien tenga más margen de horas en el mes.
- No dejes a nadie con el descanso justo antes de un vuelo largo.
- En vuelos internacionales y largos, prefiere más inglés y más margen.
- Arma una tripulación equilibrada (no juntes a los dos pilotos con menos experiencia).
- Prefiere a quien ya está en la base de salida.

Para cada puesto devuelve slot_id (exactamente el recibido), crew_id (exactamente uno de los
candidatos de ESE puesto, o texto vacío si ninguno sirve) y rationale: 1 a 3 frases en español con
datos concretos (horas, descanso, habilitación). No inventes datos.
Escribe en lenguaje natural para el supervisor: no menciones nombres de campos
(como rule_score o month_margin_hours) ni identificadores.`;

const SCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot_id', 'crew_id', 'rationale'],
        properties: {
          slot_id: { type: 'string' },
          crew_id: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
  },
};

// Datos mínimos: sin nombres, correos, teléfonos ni datos médicos.
function buildScheduleRequest({ flight, assignedCrew, options }) {
  return {
    flight: {
      flight_number: flight.flight_number,
      route: `${flight.origin}-${flight.destination}`,
      scope: flight.scope,
      aircraft_family: flight.aircraft_family,
      departure_at: flight.departure_at,
      duration_minutes: Math.round((new Date(flight.arrival_at) - new Date(flight.departure_at)) / 60000),
    },
    already_assigned: assignedCrew,
    slots: options.map(({ slot, candidates }) => ({
      slot_id: slot.id,
      label: slot.label,
      candidates: candidates.slice(0, MAX_PER_SLOT).map((candidate) => ({
        crew_id: candidate.member.user_id,
        rank: candidate.member.rank,
        base: candidate.member.base_code,
        english_level: candidate.member.english_level,
        ratings: candidate.member.ratings,
        month_hours: candidate.metrics.month_hours,
        month_margin_hours: candidate.metrics.month_margin_hours,
        rest_hours_before: candidate.metrics.rest_hours_before,
        seniority_years: candidate.member.hire_date
          ? Math.floor((Date.now() - new Date(candidate.member.hire_date)) / (365.25 * 86400000))
          : null,
        rule_score: candidate.score,
      })),
    })),
  };
}

// Acepta solo crew_id que estaban en los candidatos de ESE puesto y sin repetir
// persona entre puestos. Devuelve un mapa slot_id → { candidate, rationale }.
function validateScheduleOutput(output, options) {
  const result = new Map();
  const used = new Set();

  for (const item of (output && output.assignments) || []) {
    const option = options.find((entry) => entry.slot.id === item.slot_id);
    if (!option || result.has(item.slot_id) || !item.crew_id) continue;

    const candidate = option.candidates
      .slice(0, MAX_PER_SLOT)
      .find((entry) => entry.member.user_id === item.crew_id);
    if (!candidate || used.has(item.crew_id)) continue;
    if (typeof item.rationale !== 'string' || !item.rationale.trim()) continue;

    used.add(item.crew_id);
    result.set(item.slot_id, { candidate, rationale: item.rationale.trim() });
  }

  return result;
}

module.exports = { SCHEDULE_SYSTEM_PROMPT, SCHEDULE_SCHEMA, buildScheduleRequest, validateScheduleOutput };
