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

// Las conexiones WebSocket no pasan por las rutas de Express: llegan como
// 'upgrade' al servidor HTTP con la URL completa, así que aquí se quita el prefijo.
// /api/notification/socket.io/... -> /socket.io/...
function createSocketProxy(name, target) {
  const prefix = `/api/${name}`;

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    pathFilter: `${prefix}/socket.io`,
    pathRewrite: { [`^${prefix}`]: '' },
    on: {
      error(error) {
        console.error(`Gateway -> ${name} (WebSocket): ${error.message}`);
      },
    },
  });
}

module.exports = { createServiceProxy, createSocketProxy };
