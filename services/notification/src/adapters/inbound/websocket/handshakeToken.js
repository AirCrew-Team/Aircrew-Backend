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

// Token del socket: el de io(url, { auth: { token } }) o, si no viene, la cookie
// httpOnly aircrew_token que el navegador manda sola con withCredentials: true.
function tokenFromHandshake(handshake = {}) {
  const fromAuth = handshake.auth && handshake.auth.token;
  if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth;
  return readCookie(handshake.headers && handshake.headers.cookie, AUTH_COOKIE_NAME);
}

module.exports = { tokenFromHandshake, AUTH_COOKIE_NAME };
