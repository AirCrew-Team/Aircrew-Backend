const { adminServiceUrl } = require('../../../config/env');
const { requestJson } = require('./httpClient');

// La cuenta del usuario del token (cualquier usuario puede ver la suya).
// Se usa para guardar el nombre de quien aprobó un reemplazo.
function getUser(id, authorization) {
  return requestJson(`${adminServiceUrl}/users/${encodeURIComponent(id)}`, {
    authorization,
    serviceName: 'administración',
  });
}

module.exports = { getUser };
