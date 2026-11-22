const express = require('express');
const cors = require('cors');
const { corsOrigins } = require('./config/env');
const routes = require('./adapters/inbound/http/routes');

const app = express();

// CORS solo aquí: el gateway es el único que el navegador llama.
// No se usa express.json(): el body debe llegar intacto al servicio.
// credentials: true deja pasar la cookie de sesión; por eso los orígenes
// son explícitos (con credenciales el navegador rechaza `*`).
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use('/', routes);

module.exports = app;
