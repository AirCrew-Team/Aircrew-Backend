const {
  bogotaDate,
  bogotaDayRange,
  monthWindowForDay,
  evaluateForSlot,
  buildPlannedFlight,
} = require('../../domain/services/crewPlanning');
const {
  SCHEDULE_SYSTEM_PROMPT,
  SCHEDULE_SCHEMA,
  buildScheduleRequest,
  validateScheduleOutput,
} = require('../../domain/services/aiSchedulePolicy');
const { DomainError } = require('../../domain/errors');

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 14;

function todayInBogota() {
  return bogotaDate(new Date());
}

function addDays(date, days) {
  const day = new Date(`${date}T12:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

// Programación de tripulaciones (pantalla 3.2):
// - Las lecturas arman el vuelo con nombres y horas del mes.
// - Asignar valida las 8 reglas antes de escribir en Flights.
// - Sugerir con IA llena los puestos vacíos: reglas → Claude → validación.
//   Si Claude no responde, se informa el error. Nunca confirma solo.
// Las escrituras en Flights usan token de servicio (sus endpoints son internos).
function createCrewScheduling({
  flightsClient,
  crewClient,
  ai,
  aiCallRepository,
  serviceAuthorization,
}) {
  async function loadPlan(flightId, authorization) {
    const plan = await flightsClient.getCrewPlan(flightId, authorization);
    const date = bogotaDate(plan.departure_at);
    const [members, assignments] = await Promise.all([
      crewClient.getCrewMembers(authorization),
      flightsClient.getAssignments(monthWindowForDay(date), authorization),
    ]);
    return { plan, members, assignments };
  }

  async function getPlannedFlight(flightId, authorization) {
    const { plan, members, assignments } = await loadPlan(flightId, authorization);
    return buildPlannedFlight(plan, members, assignments);
  }

  function findSlot(plan, slotId) {
    const slot = plan.required_slots.find((item) => item.id === slotId);
    if (!slot) throw new DomainError('Ese puesto no existe en este vuelo.', 404, { code: 'slot_not_found' });
    return slot;
  }

  // Resumen de los próximos días: cuántos vuelos y cuántos sin tripulación confirmada.
  async function getScheduleDays({ from, days } = {}, authorization) {
    const start = from || todayInBogota();
    const count = days === undefined ? 7 : Number(days);
    if (!datePattern.test(start)) {
      throw new DomainError('from debe tener el formato AAAA-MM-DD.', 400, { field: 'from' });
    }
    if (!Number.isInteger(count) || count < 1 || count > MAX_DAYS) {
      throw new DomainError(`days debe ser un entero de 1 a ${MAX_DAYS}.`, 400, { field: 'days' });
    }

    const end = addDays(start, count);
    const flights = await flightsClient.listFlights(
      { from: bogotaDayRange(start).from, to: bogotaDayRange(end).from },
      authorization
    );

    return Array.from({ length: count }, (_, index) => {
      const date = addDays(start, index);
      const ofDay = flights.filter((flight) => bogotaDate(flight.departure_at) === date);
      return {
        date,
        flight_count: ofDay.length,
        pending_count: ofDay.filter((flight) => !flight.crew_confirmed_at).length,
      };
    });
  }

  // Vuelos de un día con sus puestos.
  async function getSchedule({ date } = {}, authorization) {
    const day = date || todayInBogota();
    if (!datePattern.test(day)) {
      throw new DomainError('date debe tener el formato AAAA-MM-DD.', 400, { field: 'date' });
    }

    const flights = await flightsClient.listFlights(bogotaDayRange(day), authorization);
    const [members, assignments] = await Promise.all([
      crewClient.getCrewMembers(authorization),
      flightsClient.getAssignments(monthWindowForDay(day), authorization),
    ]);

    return flights.map((flight) => {
      const onFlight = assignments.filter(
        (item) => item.flight.id === flight.id && item.status === 'assigned'
      );
      const filled = flight.required_slots.filter((slot) => onFlight.some((item) => item.slot_id === slot.id)).length;
      const crewStatus = flight.crew_confirmed_at
        ? 'confirmed'
        : filled === 0 ? 'unassigned' : filled === flight.required_slots.length ? 'complete' : 'incomplete';

      return buildPlannedFlight(
        { ...flight, crew_status: crewStatus, assignments: onFlight },
        members,
        assignments
      );
    });
  }

  // Candidatos de un puesto: elegibles ordenados y no elegibles con su motivo.
  async function getSlotCandidates(flightId, slotId, authorization) {
    const { plan, members, assignments } = await loadPlan(flightId, authorization);
    const slot = findSlot(plan, slotId);
    const { eligible, ineligible } = evaluateForSlot({ members, flight: plan, slot, assignments });

    return {
      flight_id: plan.id,
      slot: { id: slot.id, label: slot.label, accepts: slot.accepts },
      eligible: eligible.map((item) => ({
        crew_id: item.member.user_id,
        employee_code: item.member.employee_code,
        full_name: item.member.name || null,
        rank: item.member.rank,
        base: item.member.base_code,
        month_hours: item.metrics.month_hours,
        score: item.score,
        summary: item.summary,
      })),
      ineligible: ineligible.map((item) => ({
        crew_id: item.member.user_id,
        employee_code: item.member.employee_code,
        full_name: item.member.name || null,
        rank: item.member.rank,
        reason: item.reason,
      })),
    };
  }

  // Asignar a mano: primero las 8 reglas, después Flights.
  async function assignSlot(flightId, slotId, input, authorization) {
    const { crew_id: crewId } = input || {};
    const { plan, members, assignments } = await loadPlan(flightId, authorization);
    const slot = findSlot(plan, slotId);
    const member = members.find((item) => item.user_id === crewId);

    if (!member) {
      throw new DomainError('Tripulante no encontrado.', 404, { field: 'crew_id' });
    }
    if (plan.assignments.some((item) => item.slot_id === slot.id)) {
      throw new DomainError('El puesto ya está ocupado.', 409, { code: 'slot_taken' });
    }

    const { eligible, ineligible } = evaluateForSlot({ members: [member], flight: plan, slot, assignments });
    if (eligible.length === 0) {
      const reason = ineligible[0] ? ineligible[0].reason : `El puesto requiere ${slot.accepts.join(' o ')}.`;
      throw new DomainError(reason, 409, { code: 'not_eligible' });
    }

    await flightsClient.assignSlot(
      plan.id,
      slot.id,
      { crew_user_id: member.user_id, rank: member.rank, source: 'manual', rationale: null },
      serviceAuthorization()
    );

    return getPlannedFlight(plan.id, authorization);
  }

  async function removeSlot(flightId, slotId, authorization) {
    await flightsClient.removeSlot(flightId, slotId, serviceAuthorization());
    return getPlannedFlight(flightId, authorization);
  }

  async function confirmCrew(flightId, authorization) {
    await flightsClient.confirmCrew(flightId, authorization);
    return getPlannedFlight(flightId, authorization);
  }

  // Sugerir con IA los puestos vacíos del vuelo.
  async function suggestCrew(flightId, authorization) {
    const { plan, members, assignments } = await loadPlan(flightId, authorization);

    if (plan.crew_confirmed_at) {
      throw new DomainError('La tripulación de este vuelo ya está confirmada.', 409, { code: 'crew_confirmed' });
    }

    const emptySlots = plan.required_slots.filter(
      (slot) => !plan.assignments.some((item) => item.slot_id === slot.id)
    );
    if (emptySlots.length === 0) {
      throw new DomainError('El vuelo no tiene puestos vacíos.', 409, { code: 'no_empty_slots' });
    }

    // Candidatos de cada puesto vacío, sin repetir a quien ya está en el vuelo.
    const onFlight = plan.assignments.map((item) => item.crew_user_id);
    const options = emptySlots.map((slot) => ({
      slot,
      candidates: evaluateForSlot({ members, flight: plan, slot, assignments, excludeUserIds: onFlight }).eligible,
    }));

    const byUser = new Map(members.map((member) => [member.user_id, member]));
    const request = buildScheduleRequest({
      flight: plan,
      assignedCrew: plan.assignments.map((item) => {
        const member = byUser.get(item.crew_user_id) || {};
        return { slot_id: item.slot_id, rank: member.rank, english_level: member.english_level };
      }),
      options,
    });

    // Solo Claude elige. Si no responde, se informa el error (no hay respaldo).
    let chosen = new Map();
    let audit;
    if (!options.some((option) => option.candidates.length > 0)) {
      throw new DomainError('Nadie cumple las reglas para los puestos vacíos.', 409, { code: 'no_candidates' });
    }

    try {
      if (!ai.isEnabled()) throw new Error('La IA está desactivada (AI_ENABLED=false).');
      const result = await ai.decide({
        system: SCHEDULE_SYSTEM_PROMPT,
        data: request,
        schema: SCHEDULE_SCHEMA,
        effort: 'high',
      });
      chosen = validateScheduleOutput(result.output, options);
      audit = {
        usedFallback: false,
        error: chosen.size === 0 ? 'La IA no devolvió asignaciones válidas.' : null,
        model: result.model,
        response: result.output,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
      };
    } catch (error) {
      audit = { usedFallback: false, error: error.message, model: ai.model };
    }

    await aiCallRepository.saveAiCall({ kind: 'schedule', subjectId: plan.id, request, ...audit });

    if (chosen.size === 0) {
      throw new DomainError(
        'La IA no pudo sugerir la tripulación. Intenta de nuevo en unos minutos.',
        503,
        { code: 'ai_unavailable' }
      );
    }

    const picks = [];
    const unfilled = [];
    for (const { slot, candidates } of options) {
      const aiPick = chosen.get(slot.id);
      if (aiPick) {
        picks.push({ slot, candidate: aiPick.candidate, rationale: aiPick.rationale, source: 'ai' });
      } else {
        unfilled.push({
          slot_id: slot.id,
          label: slot.label,
          reason: candidates.length === 0
            ? 'Nadie cumple las reglas para este puesto.'
            : 'La IA no propuso a nadie para este puesto.',
        });
      }
    }

    if (picks.length === 0) {
      throw new DomainError('Nadie cumple las reglas para los puestos vacíos.', 409, { code: 'no_candidates' });
    }

    for (const pick of picks) {
      await flightsClient.assignSlot(
        plan.id,
        pick.slot.id,
        {
          crew_user_id: pick.candidate.member.user_id,
          rank: pick.candidate.member.rank,
          source: pick.source,
          rationale: pick.rationale,
        },
        serviceAuthorization()
      );
    }

    const planned = await getPlannedFlight(plan.id, authorization);
    return { ...planned, unfilled };
  }

  return {
    getScheduleDays,
    getSchedule,
    getPlannedFlight,
    getSlotCandidates,
    assignSlot,
    removeSlot,
    confirmCrew,
    suggestCrew,
  };
}

module.exports = createCrewScheduling;
