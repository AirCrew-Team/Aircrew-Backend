const { verifyToken } = require('../../auth/tokenVerifier');
const { tokenFromRequest } = require('../../auth/sessionToken');

// Latido: un comentario SSE para que proxies y balanceadores no corten la
// conexión por inactividad (Railway y Caddy cierran las conexiones quietas).
const HEARTBEAT_MS = 25000;
// Si se cae la conexión, el navegador (EventSource) reintenta a los 5 s.
const RETRY_MS = 5000;

// GET /stream: conexión SSE de la persona con sesión. Recibe sus avisos y, si es
// supervisor, las alertas operativas. Antes de que venza el token se envía
// auth:expired y se cierra.
function createStreamController({ publisher, heartbeatMs = HEARTBEAT_MS, now = () => Date.now() }) {
  return function stream(req, res, next) {
    let result;

    try {
      result = verifyToken(tokenFromRequest(req));
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

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: el proxy del frontend (Caddy) no la comprime ni la retiene.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${RETRY_MS}\n\n`);

    const { user, expiresAt } = result;
    const removeConnection = publisher.addConnection(user, res);
    publisher.writeEvent(res, 'connected', { message: 'Conectado a las notificaciones de AirCrew.' });

    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
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
      if (expiry) clearTimeout(expiry);
      removeConnection();
    });

    return undefined;
  };
}

module.exports = createStreamController;
