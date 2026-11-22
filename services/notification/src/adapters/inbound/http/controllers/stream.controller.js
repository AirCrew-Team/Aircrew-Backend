const { verifyToken } = require('../../auth/tokenVerifier');
const { tokenFromRequest } = require('../../auth/sessionToken');

// Latido: un comentario SSE para que proxies y balanceadores no corten la
// conexión por inactividad (Railway y Caddy cierran las conexiones quietas).
const HEARTBEAT_MS = 25000;
// Si se cae la conexión, el navegador (EventSource) reintenta a los 5 s.
const RETRY_MS = 5000;
// Con la conexión abierta, las preferencias se vuelven a leer (pasando por la caché
// de 60 s): un cambio en Configuración se aplica sin reconectar.
const PREFERENCES_MS = 60000;

// GET /stream: conexión SSE de la persona con sesión. Recibe sus avisos y, si es
// supervisor, las alertas operativas, menos los tipos que apagó en sus preferencias
// (loadDisabledTypes). El super_admin no recibe notificaciones: 403. Antes de que
// venza el token se envía auth:expired y se cierra.
function createStreamController({
  publisher,
  loadDisabledTypes,
  heartbeatMs = HEARTBEAT_MS,
  preferencesMs = PREFERENCES_MS,
  now = () => Date.now(),
}) {
  return async function stream(req, res, next) {
    const token = tokenFromRequest(req);
    let result;

    try {
      result = verifyToken(token);
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
        .json({ error: 'Se requiere una sesión válida.', code: 'auth_required' });
    }

    // Los tokens de servicio son para llamadas internas, no para escuchar avisos.
    if (result.user.role === 'service') {
      return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
    }

    if (result.user.role === 'super_admin') {
      return res
        .status(403)
        .json({ error: 'El super_admin no recibe notificaciones.', code: 'forbidden' });
    }

    const { user, expiresAt } = result;
    const preferences = { disabledTypes: await loadDisabledTypes(user, token) };

    // Se fue mientras se leían las preferencias: ya no hay a quién escribirle.
    if (req.destroyed) return undefined;

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: el proxy del frontend (Caddy) no la comprime ni la retiene.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${RETRY_MS}\n\n`);

    const removeConnection = publisher.addConnection(user, res, preferences);
    publisher.writeEvent(res, 'connected', { message: 'Conectado a las notificaciones de AirCrew.' });

    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    // loadDisabledTypes nunca falla: si admin no responde, deja de filtrar.
    const refresh = setInterval(async () => {
      preferences.disabledTypes = await loadDisabledTypes(user, token);
    }, preferencesMs);
    const expiry = expiresAt
      ? setTimeout(() => {
          publisher.writeEvent(res, 'auth:expired', {
            message: 'Tu sesión venció. Inicia sesión de nuevo.',
          });
          res.end();
        }, Math.max(0, expiresAt - now()))
      : null;

    req.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(refresh);
      if (expiry) clearTimeout(expiry);
      removeConnection();
    });

    return undefined;
  };
}

module.exports = createStreamController;
