const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const eventRoutes = require('./event.routes');
const streamRoutes = require('./stream.routes');
const notificationsRoutes = require('./notifications.routes');

const router = express.Router();
router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/events', eventRoutes);
// Avisos en vivo (SSE) y la campana.
router.use('/stream', streamRoutes);
router.use('/notifications', notificationsRoutes);

module.exports = router;
