const express = require('express');
const healthRoutes = require('./health.routes');
const tripulanteRoutes = require('./tripulante.routes');
const ausenciaRoutes = require('./ausencia.routes');
const certificacionRoutes = require('./certificacion.routes');
const asignacionRoutes = require('./asignacion.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/tripulantes', tripulanteRoutes);
router.use('/ausencias', ausenciaRoutes);
router.use('/certificaciones', certificacionRoutes);
router.use('/asignaciones', asignacionRoutes);

module.exports = router;
