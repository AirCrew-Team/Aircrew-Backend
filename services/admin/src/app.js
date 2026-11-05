const express = require('express');
const { errorHandler } = require('@vuelos/shared');
const routes = require('./adapters/inbound/http/routes');

const app = express();

app.use(express.json());
app.use('/', routes);
app.use(errorHandler);

module.exports = app;
