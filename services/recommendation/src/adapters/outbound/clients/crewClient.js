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

module.exports = { getAbsence, getCrewMembers, coverAbsence };
