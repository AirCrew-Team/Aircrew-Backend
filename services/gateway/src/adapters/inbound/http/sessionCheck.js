// Sesiones anuladas (D1): antes de pasar al servicio, el gateway pregunta a admin
// (GET /auth/me) si la sesión del token sigue valiendo: la cuenta existe, está activa
// y el token no es anterior al último cambio de contraseña.
const { AUTH_COOKIE_NAME, readCookie } = require('./cookieAuth');

const TTL_MS = 30_000;
const MAX_ENTRIES = 5000;
const TIMEOUT_MS = 3000;
const UNAVAILABLE = { error: 'No se pudo validar la sesión. Intenta de nuevo.' };

// Respuesta de admin: { status: 200 } o { status: 401, body }. Cualquier otra cosa
// (red, tiempo agotado, 5xx, otro estado o un 401 sin JSON) es null: no se cachea.
async function askAdmin(adminUrl, authorization, timeoutMs) {
  try {
    const response = await fetch(`${adminUrl}/auth/me`, {
      headers: { authorization },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 200) {
      await response.body?.cancel();
      return { status: 200 };
    }

    if (response.status === 401) {
      return { status: 401, body: await response.json() };
    }

    await response.body?.cancel();
    console.error(`Gateway -> admin (sesión): respondió ${response.status}`);
    return null;
  } catch (error) {
    console.error(`Gateway -> admin (sesión): ${error.message}`);
    return null;
  }
}

// Solo se pregunta a admin por un token con forma de JWT (tres partes base64url).
// Cualquier otra cosa la rechaza el propio servicio con 401, sin gastar una consulta.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Sesión que se valida, leída igual que el servicio más permisivo (notification,
// tokenFromRequest): el token de «Bearer …» sin espacios en los extremos y, si no hay
// uno, la cookie aircrew_token (el SSE), también recortada. Se consulta a admin con la
// forma canónica `Bearer <token>`; null si no tiene forma de JWT.
function sessionToValidate(req) {
  const { authorization } = req.headers;
  const fromHeader =
    typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
  const token = fromHeader || (readCookie(req.headers.cookie, AUTH_COOKIE_NAME) || '').trim();
  return JWT_SHAPE.test(token) ? `Bearer ${token}` : null;
}

// Caché en memoria por token: la consulta a admin (en curso o resuelta, 200 o 401)
// dura 30 s, así que las peticiones simultáneas del mismo token esperan una sola. Un
// fallo (503) sale de la caché. Con 5000 entradas sale la más antigua.
function createSessionCheck({ adminUrl, now = () => Date.now(), timeoutMs = TIMEOUT_MS }) {
  const cache = new Map();

  function validate(authorization) {
    const entry = cache.get(authorization);
    if (entry && now() - entry.at < TTL_MS) return entry.promise;

    // Se borra antes de volver a guardarla para que quede al final del orden.
    cache.delete(authorization);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);

    const promise = askAdmin(adminUrl, authorization, timeoutMs).then((result) => {
      if (!result && cache.get(authorization)?.promise === promise) cache.delete(authorization);
      return result;
    });
    cache.set(authorization, { at: now(), promise });
    return promise;
  }

  return async function sessionCheck(req, res, next) {
    const authorization = sessionToValidate(req);

    if (!authorization) {
      return next();
    }

    const result = await validate(authorization);

    if (!result) {
      return res.status(503).json(UNAVAILABLE);
    }

    if (result.status === 401) {
      return res.status(401).json(result.body);
    }

    return next();
  };
}

module.exports = { createSessionCheck, TTL_MS, MAX_ENTRIES, TIMEOUT_MS };