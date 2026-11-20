const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const catalogsRoutes = require('./catalogs.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/catalogs', catalogsRoutes);

module.exports = router;
