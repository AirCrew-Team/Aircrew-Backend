const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../config/env');

const allowedRoles = new Set(['crew', 'supervisor', 'super_admin']);

// Valida un JWT de Admin y devuelve { id, role }, o null si no es válido.
// Lo usan el middleware HTTP y el WebSocket.
function verifyToken(token) {
  if (!jwtSecret) {
    throw new Error('JWT_SECRET no está configurado.');
  }

  try {
    const payload = jwt.verify(token, jwtSecret, {
      issuer: jwtIssuer,
      algorithms: ['HS256'],
    });

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      !allowedRoles.has(payload.role)
    ) {
      return null;
    }

    return { id: payload.sub, role: payload.role };
  } catch (error) {
    return null;
  }
}

module.exports = { verifyToken };
