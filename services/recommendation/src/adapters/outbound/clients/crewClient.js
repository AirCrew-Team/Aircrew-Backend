const { crewServiceUrl } = require('../../../config/env');
const { requestJson } = require('./httpClient');

const serviceName = 'tripulación';

function getAbsence(id, authorization) {
  return requestJson(`${crewServiceUrl}/absences/${encodeURIComponent(id)}`, {
    authorization,
    serviceName,
  });
}

function getCrewMembers(authorization) {
  return requestJson(`${crewServiceUrl}/crew-members`, {
    authorization,
    serviceName,
  });
}

function coverAbsence(id, replacementUserId, authorization) {
  return requestJson(`${crewServiceUrl}/absences/${encodeURIComponent(id)}/cover`, {
    method: 'PATCH',
    body: { replacement_user_id: replacementUserId },
    authorization,
    serviceName,
  });
}

// Interno: informa a Crew el resultado de la búsqueda de reemplazos.
function updateSuggestionsState(id, { state, candidateCount }, authorization) {
  return requestJson(`${crewServiceUrl}/absences/${encodeURIComponent(id)}/suggestions`, {
    method: 'PATCH',
    body: { state, candidate_count: candidateCount },
    authorization,
    serviceName,
  });
}

// El supervisor confirmó un reemplazo: la ausencia queda esperando su «Enterado».
function approveReplacement(id, { replacementUserId, deadlineAt, option }, authorization) {
  return requestJson(`${crewServiceUrl}/absences/${encodeURIComponent(id)}/approve`, {
    method: 'PATCH',
    body: { replacement_user_id: replacementUserId, deadline_at: deadlineAt, option },
    authorization,
    serviceName,
  });
}

// Internos (token de servicio) para la revisión de plazos.
function getExpiredAbsences(authorization) {
  return requestJson(`${crewServiceUrl}/absences/expired`, { authorization, serviceName });
}

function markMissed(id, authorization) {
  return requestJson(`${crewServiceUrl}/absences/${encodeURIComponent(id)}/missed`, {
    method: 'PATCH',
    authorization,
    serviceName,
  });
}

function markAcknowledged({ flightId, replacementUserId }, authorization) {
  return requestJson(`${crewServiceUrl}/absences/acknowledged`, {
    method: 'POST',
    body: { flight_id: flightId, replacement_user_id: replacementUserId },
    authorization,
    serviceName,
  });
}

module.exports = {
  getAbsence,
  getCrewMembers,
  coverAbsence,
  updateSuggestionsState,
  approveReplacement,
  getExpiredAbsences,
  markMissed,
  markAcknowledged,
};
