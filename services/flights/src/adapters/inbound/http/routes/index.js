const express = require('express');
const healthRoutes = require('./health.routes');
const vueloRoutes = require('./vuelo.routes');
const aeronaveRoutes = require('./aeronave.routes');
const aeropuertoRoutes = require('./aeropuerto.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/vuelos', vueloRoutes);
router.use('/aeronaves', aeronaveRoutes);
router.use('/aeropuertos', aeropuertoRoutes);

module.exports = router;
