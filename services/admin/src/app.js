const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { errorHandler } = require('@vuelos/shared');
const rutas = require('./routes');

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/', rutas);
app.use(errorHandler);

module.exports = app;
