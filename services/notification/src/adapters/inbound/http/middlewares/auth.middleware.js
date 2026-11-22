const { verifyToken } = require('../../auth/tokenVerifier');

function verifyJwt(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ error: 'Se requiere autenticación.', code: 'auth_required' });
  }

  let result;

  try {
    result = verifyToken(authorization.slice('Bearer '.length));
  } catch (error) {
    error.status = 500;
    return next(error);
  }

  if (result.reason === 'expired') {
    return res
      .status(401)
      .json({ error: 'Tu sesión venció. Inicia sesión de nuevo.', code: 'token_expired' });
  }

  if (!result.user) {
    return res
      .status(401)
      .json({ error: 'El token de autenticación no es válido.', code: 'invalid_token' });
  }

  req.user = result.user;
  return next();
}

module.exports = { verifyJwt };
