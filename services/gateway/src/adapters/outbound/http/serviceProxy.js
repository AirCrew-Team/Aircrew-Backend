const { createProxyMiddleware } = require('http-proxy-middleware');

// Reenvía la petición tal cual (método, headers, body y token) al servicio.
// Express quita el prefijo montado: /api/flights/aircraft llega como /aircraft.
function createServiceProxy(name, target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 15000,
    timeout: 15000,
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
