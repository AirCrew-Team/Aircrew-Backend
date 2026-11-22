const { createProxyMiddleware } = require('http-proxy-middleware');

// Reenvía la petición tal cual (método, headers, body y token) al servicio.
// Express quita el prefijo montado: /api/flights/aircraft llega como /aircraft.
// timeoutMs: cuánto esperar la respuesta del servicio (por defecto 15 s); 0 = sin límite,
// para conexiones que quedan abiertas como el SSE de Notification.
function createServiceProxy(name, target, timeoutMs = 15000) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: timeoutMs,
    timeout: timeoutMs,
    on: {
      error(error, req, res) {
        console.error(`Gateway -> ${name}: ${error.message}`);

        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        }

        res.end(
          JSON.stringify({ error: `El servicio ${name} no está disponible.` })
        );
      },
    },
  });
}

module.exports = { createServiceProxy };
