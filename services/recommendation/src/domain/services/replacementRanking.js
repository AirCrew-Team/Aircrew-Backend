const { firstFailure, MIN_REST_HOURS, MAX_MONTH_HOURS } = require('../rules/eligibilityRules');
const { HOUR_MS, monthHours, restHoursBefore } = require('./flightTime');

// Prioridad de búsqueda para un reemplazo:
//  1. De guardia en la base de salida ahora (llega más rápido).
//  2. Libre ese día en la base de salida.
//  3. De otra base, solo si hay tiempo de traslado antes de la salida.
const TIERS = {
  standby: { level: 1, points: 50 },
  base: { level: 2, points: 35 },
  other_base: { level: 3, points: 15 },
};
const MIN_HOURS_FOR_OTHER_BASE = 4;
const MAX_FOR_AI = 15;

function tierOf(member, flight, now) {
  const atOrigin = member.base_code === flight.origin;
  const onStandby =
    member.status === 'on_duty' &&
    (!member.standby_until || new Date(member.standby_until).getTime() > now);

  if (atOrigin && onStandby) return 'standby';
  if (atOrigin) return 'base';
  return 'other_base';
}

// Puntaje del plan B (0 a 100) y los datos que lo explican. Es el orden que
// se usa si la IA está apagada o falla, y el filtro de los 15 que se le envían.
function scoreCandidate({ member, flight, memberAssignments, tier }) {
  const hours = monthHours(flight, memberAssignments);
  const margin = Math.max(0, Math.round(MAX_MONTH_HOURS - hours));
  const rest = restHoursBefore(flight, memberAssignments);
  const ramp = member.minutes_to_ramp;

  let score = TIERS[tier].points;
  score += Math.round((margin / MAX_MONTH_HOURS) * 25);
  score += rest === null || rest >= 24 ? 15 : Math.round((rest / 24) * 15);
  if (tier === 'standby' && Number.isInteger(ramp)) {
    score += Math.max(0, 10 - Math.floor(ramp / 6));
  }

  const checks = [];
  if (flight.aircraft_family) checks.push(`Habilitado ${flight.aircraft_family}`);
  if (tier === 'standby') {
    checks.push(Number.isInteger(ramp) ? `De guardia a ${ramp} min de rampa` : 'De guardia');
  } else if (tier === 'base') {
    checks.push(`Libre en ${flight.origin}`);
  } else {
    checks.push(`Base ${member.base_code || 'sin registrar'}`);
  }
  checks.push(`${margin} h de margen este mes`);
  checks.push(rest === null ? 'Sin vuelos previos cercanos' : `${Math.floor(rest)} h de descanso`);

  return {
    score: Math.min(100, score),
    checks,
    metrics: {
      tier,
      month_hours: Math.round(hours * 10) / 10,
      month_margin_hours: margin,
      rest_hours_before: rest === null ? null : Math.round(rest * 10) / 10,
      minutes_to_ramp: Number.isInteger(ramp) ? ramp : null,
    },
  };
}

function ruleRationale(candidate) {
  const { tier, month_margin_hours: margin, minutes_to_ramp: ramp } = candidate.metrics;
  const where =
    tier === 'standby'
      ? `Está de guardia${ramp !== null ? ` a ${ramp} minutos de la rampa` : ''}`
      : tier === 'base'
        ? 'Está libre en la base de salida'
        : `Está en la base ${candidate.member.base_code || 'sin registrar'}, con tiempo de traslado`;

  return `${where}, tiene ${margin} h de margen en el mes y cumple el descanso mínimo de ${MIN_REST_HOURS} h.`;
}

// Separa a quienes pueden cubrir el puesto de quienes no (con el primer motivo
// que falla) y ordena a los elegibles por prioridad y puntaje.
function evaluateReplacements({ members, flight, role, absentUserId, assignments, now = Date.now() }) {
  const hoursToDeparture = (new Date(flight.departure_at).getTime() - now) / HOUR_MS;
  const eligible = [];
  const ineligible = [];

  for (const member of members) {
    if (member.user_id === absentUserId) continue;

    const memberAssignments = assignments.filter((item) => item.crew_user_id === member.user_id);
    const context = { member, flight, role, memberAssignments };
    let reason = firstFailure(context);
    const tier = tierOf(member, flight, now);

    if (!reason && tier === 'other_base' && hoursToDeparture < MIN_HOURS_FOR_OTHER_BASE) {
      reason = `Está en otra base (${member.base_code || 'sin registrar'}) y no alcanza a llegar antes de la salida.`;
    }

    if (reason) {
      ineligible.push({ member, reason });
      continue;
    }

    const scored = scoreCandidate({ ...context, tier });
    eligible.push({ member, ...scored, rationale: null });
  }

  eligible.sort(
    (a, b) =>
      TIERS[a.metrics.tier].level - TIERS[b.metrics.tier].level ||
      b.score - a.score ||
      String(a.member.employee_code).localeCompare(String(b.member.employee_code))
  );

  for (const candidate of eligible) {
    candidate.rationale = ruleRationale(candidate);
  }

  return { eligible, ineligible };
}

function affinityLabel(affinity) {
  if (affinity >= 90) return 'optimal';
  if (affinity >= 75) return 'high';
  return 'acceptable';
}

module.exports = { evaluateReplacements, affinityLabel, MAX_FOR_AI };
