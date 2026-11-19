const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const { usersMeRouter, basesRouter } = require('./me.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/auth', authRoutes);
// /users/me va antes de /users para que no se tome "me" como un id.
router.use('/users/me', usersMeRouter);
router.use('/users', usersRoutes);
router.use('/bases', basesRouter);

module.exports = router;
