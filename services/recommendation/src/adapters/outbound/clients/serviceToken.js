const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../config/env');

// Token de servicio para llamadas internas sin usuario: la IA que corre en
// segundo plano no tiene el token de un supervisor. Lo firma este servicio con
// el mismo JWT_SECRET; vence en 1 minuto y solo los endpoints internos aceptan
// el rol `service`.
function serviceAuthorization() {
  const token = jwt.sign({ role: 'service' }, jwtSecret, {
    subject: 'service:recommendation',
    issuer: jwtIssuer,
    expiresIn: '1m',
    algorithm: 'HS256',
  });

  return `Bearer ${token}`;
}

module.exports = { serviceAuthorization };
