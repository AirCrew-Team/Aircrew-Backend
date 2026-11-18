const { verifyToken } = require('../../auth/tokenVerifier');

function verifyJwt(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Se requiere autenticación.' });
  }

  let user;

  try {
    user = verifyToken(authorization.slice('Bearer '.length));
  } catch (error) {
    error.status = 500;
    return next(error);
  }

  if (!user) {
    return res.status(401).json({ error: 'El token no es válido o ya venció.' });
  }

  req.user = user;
  return next();
}

module.exports = { verifyJwt };
