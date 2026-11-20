const express = require('express');
const { errorHandler } = require('@vuelos/shared');
const rutas = require('./adapters/inbound/http/routes');

const app = express();
const jsonBody = express.json();
// POST /absences lee su body en la ruta, con 15 MB por el comprobante.
// El resto de rutas mantiene el límite por defecto (100 kB).
const isAbsenceReport = (req) =>
  req.method === 'POST' && /^\/absences\/?$/.test(req.path);

app.use((req, res, next) =>
  isAbsenceReport(req) ? next() : jsonBody(req, res, next)
);
app.use('/', rutas);
app.use(errorHandler);

module.exports = app;
