const express = require('express');
const { errorHandler } = require('@vuelos/shared');
const routes = require('./adapters/inbound/http/routes');

const app = express();
const jsonBody = express.json();
// PUT /users/me/photo lee su body en la ruta, con 3 MB por la foto en base64.
// El resto de rutas mantiene el límite por defecto (100 kB).
const isPhotoUpload = (req) =>
  req.method === 'PUT' && /^\/users\/me\/photo\/?$/i.test(req.path);

app.use((req, res, next) =>
  isPhotoUpload(req) ? next() : jsonBody(req, res, next)
);
app.use('/', routes);
app.use(errorHandler);

module.exports = app;
