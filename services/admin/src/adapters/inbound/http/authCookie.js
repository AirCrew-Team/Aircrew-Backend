const jwt = require('jsonwebtoken');

// Cookie de sesión: el navegador la guarda y JavaScript no puede leerla.
const AUTH_COOKIE_NAME = 'aircrew_token';

function clearedAuthCookieOptions({
  isProduction = process.env.NODE_ENV === 'production',
} = {}) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: isProduction };
}

// La cookie dura lo mismo que le queda al token.
function authCookieOptions(
  token,
  { now = Date.now(), isProduction = process.env.NODE_ENV === 'production' } = {}
) {
  const { exp } = jwt.decode(token);

  return {
    ...clearedAuthCookieOptions({ isProduction }),
    maxAge: exp * 1000 - now,
  };
}

module.exports = { AUTH_COOKIE_NAME, authCookieOptions, clearedAuthCookieOptions };
