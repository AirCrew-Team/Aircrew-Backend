const express = require('express');
const cors = require('cors');
const { corsOrigins } = require('./config/env');
const routes = require('./adapters/inbound/http/routes');

const app = express();

// CORS solo aquí: el gateway es el único que el navegador llama.
// No se usa express.json(): el body debe llegar intacto al servicio.
app.use(
  cors({
    origin: corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use('/', routes);

module.exports = app;
