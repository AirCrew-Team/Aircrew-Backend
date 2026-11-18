const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const recommendationRoutes = require('./recommendation.routes');

const router = express.Router();
router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/absences', recommendationRoutes);

module.exports = router;
