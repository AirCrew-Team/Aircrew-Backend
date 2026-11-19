const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const {
  jwtSecret,
  jwtIssuer,
  superAdminBootstrapKey,
  crewServiceKey,
} = require('../../../../config/env');

function verifyJwt(req, res, next) {
  if (!jwtSecret) {
    const error = new Error('JWT_SECRET no está configurado.');
    error.status = 500;
    return next(error);
  }

  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Se requiere autenticación.', code: 'auth_required' });
  }

  const token = authorization.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, jwtSecret, {
      issuer: jwtIssuer,
      algorithms: ['HS256'],
    });

    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      return res.status(401).json({ error: 'El token de autenticación no es válido.', code: 'invalid_token' });
    }

    req.user = {
      id: payload.sub,
      role: payload.role,
    };

    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res
        .status(401)
        .json({ error: 'Tu sesión venció. Inicia sesión de nuevo.', code: 'token_expired' });
    }

    if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
      return res
        .status(401)
        .json({ error: 'El token de autenticación no es válido.', code: 'invalid_token' });
    }

    return next(error);
  }
}

function verifyConfiguredKey(req, res, next, configuredKey, headerName) {
  if (!configuredKey) {
    const error = new Error(`${headerName} no está configurado.`);
    error.status = 503;
    return next(error);
  }

  const providedKey = req.get(headerName);

  if (typeof providedKey !== 'string') {
    return res.status(401).json({ error: 'Se requiere autenticación del servicio.' });
  }

  const expected = Buffer.from(configuredKey);
  const provided = Buffer.from(providedKey);

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return res.status(401).json({ error: 'Las credenciales del servicio no son válidas.' });
  }

  return next();
}

function verifyBootstrapKey(req, res, next) {
  return verifyConfiguredKey(
    req,
    res,
    next,
    superAdminBootstrapKey,
    'x-bootstrap-key'
  );
}

function verifyCrewServiceKey(req, res, next) {
  return verifyConfiguredKey(
    req,
    res,
    next,
    crewServiceKey,
    'x-service-key'
  );
}

module.exports = { verifyJwt, verifyBootstrapKey, verifyCrewServiceKey };