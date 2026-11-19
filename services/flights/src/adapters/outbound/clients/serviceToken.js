const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../config/env');

// Token de servicio de 1 minuto para llamadas internas sin usuario.
function serviceAuthorization() {
  const token = jwt.sign({ role: 'service' }, jwtSecret, {
    subject: 'service:flights',
    issuer: jwtIssuer,
    expiresIn: '1m',
    algorithm: 'HS256',
  });

  return `Bearer ${token}`;
}

module.exports = { serviceAuthorization };
