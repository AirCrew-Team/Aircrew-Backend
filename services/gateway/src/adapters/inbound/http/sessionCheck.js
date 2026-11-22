// Sesiones anuladas (D1): antes de pasar al servicio, el gateway pregunta a admin
// (GET /auth/me) si la sesión del token sigue valiendo: la cuenta existe, está activa
// y el token no es anterior al último cambio de contraseña.
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

// Caché en memoria por cabecera Authorization: 200 y 401 durante 30 s. Al pasar de
// 5000 entradas se vacía entera. Sin Authorization no valida: cada servicio exige su
// token. Con otro esquema que no sea Bearer también valida (admin responde 401):
// notification leería entonces la cookie aircrew_token, que no pasaría por aquí.
function createSessionCheck({ adminUrl, now = () => Date.now(), timeoutMs = TIMEOUT_MS }) {
  const cache = new Map();

  return async function sessionCheck(req, res, next) {
    const authorization = req.headers.authorization;

    if (typeof authorization !== 'string' || !authorization) {
      return next();
    }

    let result = cache.get(authorization);

    if (!result || now() - result.at >= TTL_MS) {
      result = await askAdmin(adminUrl, authorization, timeoutMs);

      if (!result) {
        cache.delete(authorization);
        return res.status(503).json(UNAVAILABLE);
      }

      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(authorization, { ...result, at: now() });
    }

    if (result.status === 401) {
      return res.status(401).json(result.body);
    }

    return next();
  };
}

module.exports = { createSessionCheck, TTL_MS, MAX_ENTRIES, TIMEOUT_MS };
