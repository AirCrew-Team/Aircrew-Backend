const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const eventRoutes = require('./event.routes');

const router = express.Router();
router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/events', eventRoutes);

module.exports = router;
