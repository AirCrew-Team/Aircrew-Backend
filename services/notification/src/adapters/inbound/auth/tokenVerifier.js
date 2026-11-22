const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../config/env');

// service: token de 1 minuto que firma otro servicio para llamadas internas
// sin usuario (por ejemplo, la IA que corre en segundo plano).
const allowedRoles = new Set(['crew', 'supervisor', 'super_admin', 'service']);

// Valida un JWT de Admin. Lo usan el middleware HTTP y el WebSocket.
// Devuelve { user, expiresAt } si es válido, o { reason } si no:
// 'expired' (venció) o 'invalid' (mal firmado, otro emisor o datos raros).
function verifyToken(token) {
  if (!jwtSecret) {
    throw new Error('JWT_SECRET no está configurado.');
  }

  let payload;

  try {
    payload = jwt.verify(token, jwtSecret, {
      issuer: jwtIssuer,
      algorithms: ['HS256'],
    });
  } catch (error) {
    return { reason: error.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    !allowedRoles.has(payload.role)
  ) {
    return { reason: 'invalid' };
  }

  return {
    user: { id: payload.sub, role: payload.role },
    expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
  };
}

module.exports = { verifyToken };
