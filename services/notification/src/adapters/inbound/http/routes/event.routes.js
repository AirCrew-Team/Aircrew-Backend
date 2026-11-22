const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const ssePublisher = require('../../../outbound/publishers/ssePublisher');
const notificationRepository = require('../../../outbound/persistence/repositories/notificationRepository');
const {
  createAbsenceReportedAlert,
  createAbsenceCoveredAlert,
  createSuggestionsReadyAlert,
  createDeadlineMissedAlert,
  createAssignmentReplacementAlert,
  createCertificationAlert,
} = require('../../../../domain/alerts');
const createPublishAlert = require('../../../../application/use-cases/publishAlert');
const createNotifyUser = require('../../../../application/use-cases/notifyUser');
const createEventController = require('../controllers/event.controller');

const router = express.Router();
const notifyUser = createNotifyUser({ notificationRepository, publisher: ssePublisher });

const publishSuggestionsReady = createPublishAlert({
  buildAlert: createSuggestionsReadyAlert,
  publisher: ssePublisher,
  notificationRepository,
  fromInput: (input) => input,
});

const publishDeadlineMissed = createPublishAlert({
  buildAlert: createDeadlineMissedAlert,
  publisher: ssePublisher,
  notificationRepository,
  fromInput: (input) => input,
});

// Avisos para un tripulante: se guardan en su historial y se entregan en vivo.
function notifyCrewMember(buildAlert) {
  return (input) => {
    const alert = buildAlert(input);
    return notifyUser(alert.crew_user_id, alert);
  };
}

function respond(publish) {
  return async (req, res, next) => {
    try {
      return res.status(202).json(await publish(req.body));
    } catch (error) {
      return next(error);
    }
  };
}

const controller = createEventController({
  publishAbsenceReported: createPublishAlert({
    buildAlert: createAbsenceReportedAlert,
    publisher: ssePublisher,
    notificationRepository,
  }),
  publishAbsenceCovered: createPublishAlert({
    buildAlert: createAbsenceCoveredAlert,
    publisher: ssePublisher,
    notificationRepository,
  }),
});

// Crew avisa con el token del tripulante que reportó; Recommendation, con
// el del supervisor que confirmó.
router.post('/absence-reported', verifyJwt, allowRoles('crew'), controller.absenceReported);
router.post(
  '/absence-covered',
  verifyJwt,
  allowRoles('supervisor', 'super_admin', 'service'),
  controller.absenceCovered
);

// Recommendation avisa (token de servicio) que terminó la búsqueda de candidatos.
router.post('/suggestions-ready', verifyJwt, allowRoles('service'), respond(publishSuggestionsReady));

// Recommendation: el reemplazo no confirmó a tiempo.
router.post('/deadline-missed', verifyJwt, allowRoles('service'), respond(publishDeadlineMissed));
// Recommendation (al confirmar un reemplazo): aviso al tripulante elegido.
router.post(
  '/assignment-replacement',
  verifyJwt,
  allowRoles('supervisor', 'super_admin', 'service'),
  respond(notifyCrewMember(createAssignmentReplacementAlert))
);
// Crew (token de servicio): el super_admin le registró o verificó su certificación.
router.post(
  '/certification',
  verifyJwt,
  allowRoles('service'),
  respond(notifyCrewMember(createCertificationAlert))
);

module.exports = router;
