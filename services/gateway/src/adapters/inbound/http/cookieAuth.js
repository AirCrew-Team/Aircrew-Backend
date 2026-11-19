// Cookie de sesión que pone el servicio admin al iniciar sesión.
const AUTH_COOKIE_NAME = 'aircrew_token';

// Lee una cookie de la cabecera Cookie (`a=1; b=2`) sin cookie-parser.
function readCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');

    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      // Un valor mal codificado se ignora en vez de tumbar la petición con un 500.
      try {
        return decodeURIComponent(pair.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

// Los servicios siguen verificando Authorization: si el navegador manda la
// cookie y no hay header, se convierte en `Bearer <token>`.
function cookieToAuthorization(req, res, next) {
  const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);

  if (!req.headers.authorization && token) {
    req.headers.authorization = `Bearer ${token}`;
  }

  return next();
}

module.exports = { AUTH_COOKIE_NAME, readCookie, cookieToAuthorization };
