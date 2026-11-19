const { flightsServiceUrl } = require('../../../config/env');
const { requestJson } = require('./httpClient');

const serviceName = 'vuelos';

function getFlight(id, authorization) {
  return requestJson(`${flightsServiceUrl}/flights/${encodeURIComponent(id)}`, {
    authorization,
    serviceName,
  });
}

function getAssignments({ from, to }, authorization) {
  const query = new URLSearchParams({ from, to });
  return requestJson(`${flightsServiceUrl}/assignments?${query}`, {
    authorization,
    serviceName,
  });
}

function replaceCrewMember(flightId, body, authorization) {
  return requestJson(
    `${flightsServiceUrl}/flights/${encodeURIComponent(flightId)}/assignments/replace`,
    { method: 'POST', body, authorization, serviceName }
  );
}

// Interno: deshace un reemplazo cuyo plazo de «Enterado» venció.
function revertReplacement(flightId, crewUserId, authorization) {
  return requestJson(
    `${flightsServiceUrl}/flights/${encodeURIComponent(flightId)}/assignments/revert`,
    { method: 'POST', body: { crew_user_id: crewUserId }, authorization, serviceName }
  );
}

module.exports = { getFlight, getAssignments, replaceCrewMember, revertReplacement };
