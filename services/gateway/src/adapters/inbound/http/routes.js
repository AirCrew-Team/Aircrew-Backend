const express = require('express');
const { services, docsPublic } = require('../../../config/env');
const { createServiceProxy } = require('../../outbound/http/serviceProxy');
const { cookieToAuthorization } = require('./cookieAuth');
const { createSessionCheck } = require('./sessionCheck');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ service: 'gateway', status: 'ok' });
});

// El frontend llama a /api/<servicio>/<ruta>; el gateway no tiene lógica de
// negocio: cada servicio sigue verificando el token. El gateway solo comprueba
// con admin que la sesión no se haya anulado (sessionCheck).
// Recommendation espera a la IA (Claude puede tardar hasta un minuto en
// sugerir una tripulación completa): se le da más tiempo que al resto.
const TIMEOUTS = { recommendation: 120000 };

// Rutas que solo usan los servicios entre sí (por la red privada) o que no deben
// verse desde Internet. Se comparan sin mayúsculas, decodificadas y sin barras
// repetidas, porque Express las enrutaría igual al servicio. Una ruta con
// segmentos «.» o «..» (que ningún cliente legítimo envía) se rechaza entera.
const PRIVATE_ROUTES = [
  /^\/api\/[^/]+\/internal(\/|$)/,
  /^\/api\/admin\/users\/lookup(\/|$)/,
  /^\/api\/notification\/events(\/|$)/,
];
const DOCS_ROUTE = /^\/api\/[^/]+\/docs(\/|$)/;
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

function normalizedPath(url) {
  try {
    const path = decodeURIComponent(url.split('?')[0]).replace(/\/{2,}/g, '/').toLowerCase();
    return DOT_SEGMENT.test(path) ? null : path;
  } catch {
    return null;
  }
}

router.use((req, res, next) => {
  const path = normalizedPath(req.url);
  const blocked =
    path === null ||
    PRIVATE_ROUTES.some((route) => route.test(path)) ||
    (!docsPublic && DOCS_ROUTE.test(path));
  if (blocked) return res.status(404).json({ error: 'Ruta no encontrada.' });
  return next();
});

router.use(cookieToAuthorization);

// Las rutas /api/admin/auth/* (login, logout, bootstrap, activación, recuperación y
// el propio /auth/me) gestionan su sesión ellas mismas: no se validan aquí.
const SESSION_FREE_ROUTE = /^\/api\/admin\/auth(\/|$)/;
const sessionCheck = createSessionCheck({ adminUrl: services.admin });
router.use((req, res, next) =>
  SESSION_FREE_ROUTE.test(normalizedPath(req.url)) ? next() : sessionCheck(req, res, next)
);

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
