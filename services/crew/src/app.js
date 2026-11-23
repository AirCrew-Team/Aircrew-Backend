const express = require('express');
const { errorHandler } = require('@vuelos/shared');
const rutas = require('./adapters/inbound/http/routes');

const app = express();
const jsonBody = express.json();
// POST /absences (comprobante) y PUT /certifications/:userId (copia del
// certificado) leen su body en la ruta, con un límite mayor. El resto de rutas
// mantiene el límite por defecto (100 kB).
const readsBodyInRoute = (req) =>
  (req.method === 'POST' && /^\/absences\/?$/.test(req.path)) ||
  (req.method === 'PUT' && /^\/certifications\/[^/]+\/?$/.test(req.path));

app.use((req, res, next) =>
  readsBodyInRoute(req) ? next() : jsonBody(req, res, next)
);
app.use('/', rutas);
app.use(errorHandler);

module.exports = app;
