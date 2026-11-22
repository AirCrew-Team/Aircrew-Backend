const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const notificationRepository = require('../../../outbound/persistence/repositories/notificationRepository');
const createManageMyNotifications = require('../../../../application/use-cases/manageMyNotifications');

// Campana: los avisos guardados de la persona con sesión (cualquier rol con usuario).
const router = express.Router();
const notifications = createManageMyNotifications({ notificationRepository });

function respond(run) {
  return async (req, res, next) => {
    try {
      return res.status(200).json(await run(req));
    } catch (error) {
      return next(error);
    }
  };
}

router.use(verifyJwt, allowRoles('crew', 'supervisor', 'super_admin'));
router.get('/', respond((req) => notifications.listMine(req.user, { limit: req.query.limit })));
// Antes de /:id/read.
router.post('/read-all', respond((req) => notifications.markAllRead(req.user)));
router.patch('/:id/read', respond((req) => notifications.markRead(req.user, req.params.id)));

module.exports = router;
