const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../../config/env');

const allowedRoles = new Set(['crew', 'supervisor', 'super_admin']);

function verificarJwt(req, res, next) {
  if (!jwtSecret) {
    const error = new Error('JWT_SECRET is not configured.');
    error.status = 500;
    return next(error);
  }

  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(
      authorization.slice('Bearer '.length),
      jwtSecret,
      {
        issuer: jwtIssuer,
        algorithms: ['HS256'],
      }
    );

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.role !== 'string' ||
      !allowedRoles.has(payload.role)
    ) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    req.usuario = {
      id: payload.sub,
      rol: payload.role,
    };

    return next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    return next(error);
  }
}

module.exports = { verificarJwt };
