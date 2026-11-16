const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const flightRoutes = require('./flight.routes');
const aircraftRoutes = require('./aircraft.routes');
const airportRoutes = require('./airport.routes');
const assignmentRoutes = require('./assignment.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/flights', flightRoutes);
router.use('/aircraft', aircraftRoutes);
router.use('/airports', airportRoutes);
router.use('/assignments', assignmentRoutes);

module.exports = router;
