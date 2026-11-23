const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const recommendationRoutes = require('./recommendation.routes');
const { scheduleRouter, flightRouter } = require('./scheduling.routes');
const internalRoutes = require('./internal.routes');

const router = express.Router();
router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/absences', recommendationRoutes);
router.use('/schedule', scheduleRouter);
router.use('/flights', flightRouter);
// Solo para otros servicios (token de servicio).
router.use('/internal', internalRoutes);

module.exports = router;
