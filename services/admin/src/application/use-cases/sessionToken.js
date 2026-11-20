const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn, jwtIssuer } = require('../../config/env');

// JWT de la sesión: lo firman el login y el cambio de contraseña con sesión.
// `issuedAt` (segundos) fija el iat; sin él, jsonwebtoken usa la hora actual.
// El vencimiento se cuenta desde el iat.
function signSessionToken({ id, role }, { issuedAt } = {}) {
  const payload = issuedAt === undefined ? { role } : { role, iat: issuedAt };

  return jwt.sign(payload, jwtSecret, {
    subject: id,
    expiresIn: jwtExpiresIn,
    issuer: jwtIssuer,
  });
}

module.exports = { signSessionToken };
