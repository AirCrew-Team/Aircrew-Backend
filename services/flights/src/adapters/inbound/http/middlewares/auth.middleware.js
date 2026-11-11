const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer } = require('../../../../config/env');

const allowedRoles = new Set(['crew', 'supervisor', 'super_admin']);

function verifyJwt(req, res, next) {
  if (!jwtSecret) {
    const error = new Error('JWT_SECRET no está configurado.');
    error.status = 500;
    return next(error);
  }

  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Se requiere autenticación.' });
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
      return res.status(401).json({ error: 'El token de autenticación no es válido.' });
    }

    req.user = {
      id: payload.sub,
      role: payload.role,
    };

    return next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ error: 'El token no es válido o ya venció.' });
    }

    return next(error);
  }
}

module.exports = { verifyJwt };
