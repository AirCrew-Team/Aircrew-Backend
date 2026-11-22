const express = require('express');
const { services } = require('../../../config/env');
const { createServiceProxy } = require('../../outbound/http/serviceProxy');
const { cookieToAuthorization } = require('./cookieAuth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ service: 'gateway', status: 'ok' });
});

// El frontend llama a /api/<servicio>/<ruta>; el gateway no tiene lógica de
// negocio ni valida el token: cada servicio lo sigue verificando.
// Recommendation espera a la IA (Claude puede tardar hasta un minuto en
// sugerir una tripulación completa): se le da más tiempo que al resto.
const TIMEOUTS = { recommendation: 120000 };

router.use(cookieToAuthorization);

// Notification: GET /stream es una conexión SSE que queda abierta (avisos en vivo),
// así que va sin límite de tiempo. El resto de sus rutas, con el de siempre.
const notificationStream = createServiceProxy('notification', services.notification, 0);
const notificationProxy = createServiceProxy('notification', services.notification);
router.use('/api/notification', (req, res, next) =>
  /^\/stream\/?(\?|$)/.test(req.url)
    ? notificationStream(req, res, next)
    : notificationProxy(req, res, next)
);

for (const [name, target] of Object.entries(services)) {
  if (name !== 'notification') {
    router.use(`/api/${name}`, createServiceProxy(name, target, TIMEOUTS[name]));
  }
}

router.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

module.exports = router;
