const { hubTimezone, localDate, localDayRange } = require('@vuelos/shared');
const { firstFailure, warningsFor, absenceFor, MAX_MONTH_HOURS, MIN_REST_HOURS } = require('../rules/eligibilityRules');
const { monthHours, restHoursBefore, durationHours, assignmentsWindow } = require('./flightTime');

const STATUS_BY_CREW = {
  unassigned: 'unassigned',
  incomplete: 'incomplete',
  complete: 'complete',
  confirmed: 'confirmed',
};

// Asignaciones a pedir para evaluar un día local de la zona timeZone: el mes local
// de cada tripulante para los vuelos de ese día (regla de 100 h) más un día a cada lado.
function monthWindowForDay(date, timeZone) {
  const { from, to } = localDayRange(date, timeZone);
  return assignmentsWindow(from, to);
}

// La regla de rango usa la clave del puesto (relief acepta capitán o primer oficial).
function ruleRoleFor(slot) {
  return slot.id === 'relief' ? 'relief' : slot.role;
}

// Puntaje de programación (0 a 100) para elegir qué candidatos se le envían a
// la IA y en qué orden se muestran en la lista de candidatos: reparte la carga
// (más margen de horas), cuida el descanso y prefiere a quien ya está en la base.
function planningScore({ member, flight, memberAssignments }) {
  const hours = monthHours(flight, memberAssignments, member.base_code);
  const margin = Math.max(0, Math.round(MAX_MONTH_HOURS - hours - durationHours(flight)));
  const rest = restHoursBefore(flight, memberAssignments);

  let score = Math.round((margin / MAX_MONTH_HOURS) * 60);
  score += rest === null || rest >= 24 ? 30 : Math.round((rest / 24) * 30);
  if (member.base_code === flight.origin) score += 10;

  const summary = [
    flight.aircraft_family ? `Habilitado en ${flight.aircraft_family}` : null,
    `${Math.round(hours)} h de ${MAX_MONTH_HOURS}`,
    rest === null ? 'sin vuelos previos cercanos' : `${Math.floor(rest)} h de descanso`,
  ].filter(Boolean).join(' · ');

  return {
    score: Math.min(100, score),
    summary,
    metrics: {
      month_hours: Math.round(hours * 10) / 10,
      month_margin_hours: margin,
      rest_hours_before: rest === null ? null : Math.round(rest * 10) / 10,
      at_origin_base: member.base_code === flight.origin,
    },
  };
}

// Elegibles para un puesto (las 8 reglas) ordenados por puntaje, y no elegibles
// con el primer motivo que falla. excludeUserIds: ya usados en otro puesto.
function evaluateForSlot({ members, flight, slot, assignments, excludeUserIds = [] }) {
  const eligible = [];
  const ineligible = [];

  for (const member of members) {
    if (excludeUserIds.includes(member.user_id)) continue;

    const memberAssignments = assignments.filter((item) => item.crew_user_id === member.user_id);
    const context = { member, flight, role: ruleRoleFor(slot), memberAssignments };
    const reason = firstFailure(context);

    if (reason) {
      // Solo se informan los del rango del puesto: al resto no tiene sentido listarlo.
      if (slot.accepts.includes(member.rank)) ineligible.push({ member, reason });
      continue;
    }

    // Dato sin registrar (p. ej. recién creado): elegible, con advertencia y al final.
    const warnings = warningsFor(context);
    const scored = planningScore(context);
    // Sin habilitación registrada, el resumen no puede decir «Habilitado en».
    const noRating = warnings.some((warning) => warning.startsWith('Sin habilitación'));
    const summary =
      warnings.length === 0
        ? scored.summary
        : [
            ...warnings,
            ...scored.summary.split(' · ').filter((part) => !(noRating && part.startsWith('Habilitado en'))),
          ].join(' · ');
    eligible.push({ member, ...scored, summary, warnings });
  }

  eligible.sort(
    (a, b) =>
      Number(a.warnings.length > 0) - Number(b.warnings.length > 0) ||
      b.score - a.score ||
      String(a.member.employee_code).localeCompare(String(b.member.employee_code))
  );

  return { eligible, ineligible };
}

function ruleRationale(candidate, flight) {
  const { month_margin_hours: margin, rest_hours_before: rest } = candidate.metrics;
  return `Habilitado en ${flight.aircraft_family || 'el avión'}, con ${margin} h de margen en el mes${
    rest === null ? ' y sin vuelos previos cercanos' : ` y ${Math.floor(rest)} h de descanso (mínimo ${MIN_REST_HOURS})`
  }.`;
}

// Arma el vuelo programado que muestra la pantalla de Programación. date es el
// día local en timeZone: la de la base de la lista o, para un vuelo suelto, la
// de su aeropuerto de salida (Nueva York si no es un hub).
function buildPlannedFlight(plan, members, assignments, timeZone = hubTimezone(plan.origin)) {
  const byUser = new Map(members.map((member) => [member.user_id, member]));
  const slots = plan.required_slots.map((slot) => {
    const taken = plan.assignments.find((item) => item.slot_id === slot.id);
    const member = taken ? byUser.get(taken.crew_user_id) || {} : null;
    const memberAssignments = taken
      ? assignments.filter((item) => item.crew_user_id === taken.crew_user_id)
      : [];

    return {
      id: slot.id,
      role: slot.role,
      accepts: slot.accepts,
      label: slot.label,
      assignee: taken
        ? {
            crew_id: taken.crew_user_id,
            employee_code: member.employee_code || null,
            full_name: member.name || null,
            rank: member.rank || null,
            month_hours: Math.round(monthHours(plan, memberAssignments, member.base_code) + durationHours(plan)),
            max_month_hours: MAX_MONTH_HOURS,
            source: taken.source,
            rationale: taken.rationale,
            is_replacement: taken.is_replacement,
            // Datos sin registrar (p. ej. recién creado): la pantalla los avisa.
            warnings: member.user_id ? warningsFor({ member, flight: plan }) : [],
            // Se ausentó después de asignarlo: sigue en el puesto hasta que se confirme su
            // reemplazo, pero la pantalla lo marca y el vuelo no cuenta como completo.
            absence: member.user_id ? absenceFor({ member, flight: plan }) : null,
          }
        : null,
    };
  });
  const hasAbsentAssignee = slots.some((slot) => slot.assignee && slot.assignee.absence);
  const crewStatus =
    hasAbsentAssignee && plan.crew_status === 'complete' ? 'incomplete' : plan.crew_status;

  const pilots = plan.required_slots.filter((slot) => slot.accepts.some((rank) => ['captain', 'first_officer'].includes(rank))).length;

  return {
    id: plan.id,
    flight_number: plan.flight_number,
    date: localDate(plan.departure_at, timeZone),
    origin: { code: plan.origin, city: plan.origin_city || null },
    destination: { code: plan.destination, city: plan.destination_city || null },
    departure_at: plan.departure_at,
    arrival_at: plan.arrival_at,
    duration_minutes: Math.round(durationHours(plan) * 60),
    scope: plan.scope,
    gate: plan.gate,
    aircraft: {
      model: plan.aircraft_name,
      family: plan.aircraft_family,
      registration: plan.aircraft_registration,
      seats: plan.aircraft_seats,
    },
    minimum_crew: { pilots, cabin: plan.required_slots.length - pilots },
    status: STATUS_BY_CREW[crewStatus] || crewStatus,
    slots,
  };
}

module.exports = {
  monthWindowForDay,
  evaluateForSlot,
  ruleRationale,
  buildPlannedFlight,
};
