const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../config/env');

// Token de servicio de 1 minuto para las rutas internas de flights, notification y
// recommendation, que ya aceptan el rol `service` (lo firman igual crew, flights y
// recommendation). Usa el mismo JWT_SECRET: no hace falta otra clave.
function serviceAuthorization() {
  const token = jwt.sign({ role: 'service' }, jwtSecret, {
    subject: 'service:admin',
    issuer: jwtIssuer,
    expiresIn: '1m',
    algorithm: 'HS256',
  });

  return `Bearer ${token}`;
}

module.exports = { serviceAuthorization };
