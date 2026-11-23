const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const { tokenFromRequest } = require('../../auth/sessionToken');
const notificationRepository = require('../../../outbound/persistence/repositories/notificationRepository');
const { loadDisabledTypes } = require('../../../outbound/clients/adminClient');
const createManageMyNotifications = require('../../../../application/use-cases/manageMyNotifications');

// Campana: los avisos guardados de la persona con sesión (crew y supervisor), sin los
// tipos que apagó en sus preferencias. El super_admin no recibe notificaciones: 403.
const router = express.Router();
const notifications = createManageMyNotifications({ notificationRepository, loadDisabledTypes });

function rejectSuperAdmin(req, res, next) {
  if (req.user.role === 'super_admin') {
    return res.status(403).json({ error: 'El super_admin no recibe notificaciones.', code: 'forbidden' });
  }

  return next();
}

function respond(run) {
  return async (req, res, next) => {
    try {
      return res.status(200).json(await run(req));
    } catch (error) {
      return next(error);
    }
  };
}

router.use(verifyJwt, rejectSuperAdmin, allowRoles('crew', 'supervisor'));
router.get(
  '/',
  respond((req) =>
    notifications.listMine(req.user, { limit: req.query.limit, token: tokenFromRequest(req) })
  )
);
// Antes de /:id/read.
router.post('/read-all', respond((req) => notifications.markAllRead(req.user)));
router.patch('/:id/read', respond((req) => notifications.markRead(req.user, req.params.id)));

module.exports = router;
