const express = require('express');
const { services } = require('../../../config/env');
const { createServiceProxy } = require('../../outbound/http/serviceProxy');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ service: 'gateway', status: 'ok' });
});

// El frontend llama a /api/<servicio>/<ruta>; el gateway no tiene lógica de
// negocio ni valida el token: cada servicio lo sigue verificando.
for (const [name, target] of Object.entries(services)) {
  router.use(`/api/${name}`, createServiceProxy(name, target));
}

router.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

module.exports = router;
