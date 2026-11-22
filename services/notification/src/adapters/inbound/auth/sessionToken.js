// Cookie de sesión que pone Admin al iniciar sesión (la misma que lee el gateway).
const AUTH_COOKIE_NAME = 'aircrew_token';

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      // Un valor mal codificado se ignora en vez de tumbar la conexión.
      try {
        return decodeURIComponent(pair.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

// Token de la petición: «Authorization: Bearer …» (lo pone el gateway a partir de la
// cookie) o, si no viene, la cookie httpOnly aircrew_token. EventSource no puede
// mandar headers propios, pero sí manda la cookie con withCredentials: true.
function tokenFromRequest(req) {
  const authorization = req.headers && req.headers.authorization;

  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return readCookie(req.headers && req.headers.cookie, AUTH_COOKIE_NAME);
}

module.exports = { tokenFromRequest, readCookie, AUTH_COOKIE_NAME };
