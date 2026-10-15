const express = require('express');
const { errorHandler } = require('@vuelos/shared');
const rutas = require('./adapters/inbound/http/routes');

const app = express();

app.use(express.json());
app.use('/', rutas);
app.use(errorHandler);

module.exports = app;
