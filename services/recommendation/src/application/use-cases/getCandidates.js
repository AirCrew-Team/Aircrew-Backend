const { isValidAbsenceId } = require('../../domain/entities/replacementRequest');
const { affinityLabel } = require('../../domain/services/replacementRanking');
const { DomainError } = require('../../domain/errors');

function absentNotAssignedError() {
  return new DomainError(
    'El tripulante ausente ya no tiene asignación activa en este vuelo.',
    409,
    { code: 'absent_not_assigned' }
  );
}

function toFlightSummary(flight) {
  return {
    id: flight.id,
    flight_number: flight.flight_number,
    origin: flight.origin,
    destination: flight.destination,
    departure_at: flight.departure_at,
    arrival_at: flight.arrival_at,
    gate: flight.gate || null,
    scope: flight.scope || null,
    aircraft_family: flight.aircraft_family || null,
  };
}

// Candidatos de la última ronda guardada para una ausencia, con los datos de
// cada tripulante para la tarjeta (ubicación, minutos a rampa, contacto).
// Si la IA todavía está buscando, devuelve la lista vacía con
// suggestions_state = "searching".
function createGetCandidates({ crewClient, flightsClient, suggestionRepository }) {
  return async function getCandidates(absenceId, authorization) {
    if (!isValidAbsenceId(absenceId)) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    const absence = await crewClient.getAbsence(absenceId, authorization);
    const [flight, members, suggestions] = await Promise.all([
      flightsClient.getFlight(absence.flight_id, authorization),
      crewClient.getCrewMembers(authorization),
      suggestionRepository.findLatestRound(absence.id),
    ]);

    const byUser = new Map(members.map((member) => [member.user_id, member]));

    return {
      absence: {
        id: absence.id,
        crew_user_id: absence.crew_user_id,
        crew_name: absence.crew_name || null,
        employee_code: absence.employee_code || null,
        reason: absence.reason,
        notes: absence.notes,
        status: absence.status,
        reported_at: absence.created_at,
      },
      flight: toFlightSummary(flight),
      slot_role: absence.slot_role,
      suggestions_state: absence.suggestions_state,
      round: suggestions[0] ? suggestions[0].round : null,
      candidates: suggestions.map((suggestion) => {
        const member = byUser.get(suggestion.crew_user_id) || {};
        return {
          user_id: suggestion.crew_user_id,
          full_name: member.name || null,
          employee_code: member.employee_code || null,
          rank: member.rank || null,
          base: member.base_code || null,
          rank_position: suggestion.rank_position,
          affinity: suggestion.affinity,
          affinity_label: affinityLabel(suggestion.affinity),
          checks: suggestion.checks,
          rationale: suggestion.rationale,
          source: suggestion.source,
          status: suggestion.status,
          location: member.standby_location || member.base_code || null,
          minutes_to_ramp: Number.isInteger(member.minutes_to_ramp) ? member.minutes_to_ramp : null,
          phone: member.phone || null,
          radio_channel: member.radio_channel || null,
        };
      }),
    };
  };
}

module.exports = createGetCandidates;
module.exports.absentNotAssignedError = absentNotAssignedError;
module.exports.toFlightSummary = toFlightSummary;
