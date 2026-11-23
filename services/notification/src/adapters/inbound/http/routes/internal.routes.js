const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const ssePublisher = require('../../../outbound/publishers/ssePublisher');
const notificationRepository = require('../../../outbound/persistence/repositories/notificationRepository');
const { createSlotVacatedAlert } = require('../../../../domain/alerts');
const createPublishAlert = require('../../../../application/use-cases/publishAlert');
const { DomainError } = require('../../../../domain/errors');

// Rutas que solo usan otros servicios, con token de servicio. El gateway responde
// 404 a /api/notification/internal/* (BE-1).
const router = express.Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publishSlotVacated = createPublishAlert({
  buildAlert: createSlotVacatedAlert,
  publisher: ssePublisher,
  notificationRepository,
  fromInput: (input) => input,
});

router.use(verifyJwt, allowRoles('service'));

// Admin eliminó a un tripulante: un puesto de un vuelo futuro quedó vacante.
router.post('/alerts/slot-vacated', async (req, res, next) => {
  try {
    return res.status(202).json(await publishSlotVacated(req.body));
  } catch (error) {
    return next(error);
  }
});

// Admin eliminó la cuenta: borra sus notificaciones. Repetirlo no falla: devuelve 0.
router.delete('/users/:userId/notifications', async (req, res, next) => {
  try {
    if (!uuidPattern.test(req.params.userId)) {
      throw new DomainError('Se requiere un id de usuario válido.');
    }
    return res.status(200).json(await notificationRepository.deleteForUser(req.params.userId));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
