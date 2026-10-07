const express = require('express');
const healthRoutes = require('./health.routes');
const usuarioRoutes = require('./usuario.routes');
const parametroRoutes = require('./parametro.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/usuarios', usuarioRoutes);
router.use('/parametros', parametroRoutes);

module.exports = router;
