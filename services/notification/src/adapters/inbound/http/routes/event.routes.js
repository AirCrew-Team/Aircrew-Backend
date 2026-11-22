const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const socketPublisher = require('../../../outbound/publishers/socketPublisher');
const {
  createAbsenceReportedAlert,
  createAbsenceCoveredAlert,
  createSuggestionsReadyAlert,
  createDeadlineMissedAlert,
  createAssignmentReplacementAlert,
} = require('../../../../domain/alerts');
const createPublishAlert = require('../../../../application/use-cases/publishAlert');
const createEventController = require('../controllers/event.controller');

const router = express.Router();
const publishSuggestionsReady = createPublishAlert({
  buildAlert: createSuggestionsReadyAlert,
  publisher: socketPublisher,
  fromInput: (input) => input,
});

const publishDeadlineMissed = createPublishAlert({
  buildAlert: createDeadlineMissedAlert,
  publisher: socketPublisher,
  fromInput: (input) => input,
});

// Va a la sala personal del tripulante, no a los supervisores.
function publishAssignmentReplacement(input) {
  const alert = createAssignmentReplacementAlert(input);
  const deliveredTo = socketPublisher.publishToUser(alert.crew_user_id, alert);
  return { type: alert.type, message: alert.message, delivered_to: deliveredTo };
}

function respond(publish) {
  return (req, res, next) => {
    try {
      return res.status(202).json(publish(req.body));
    } catch (error) {
      return next(error);
    }
  };
}

const controller = createEventController({
  publishAbsenceReported: createPublishAlert({
    buildAlert: createAbsenceReportedAlert,
    publisher: socketPublisher,
  }),
  publishAbsenceCovered: createPublishAlert({
    buildAlert: createAbsenceCoveredAlert,
    publisher: socketPublisher,
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
router.post('/suggestions-ready', verifyJwt, allowRoles('service'), (req, res, next) => {
  try {
    return res.status(202).json(publishSuggestionsReady(req.body));
  } catch (error) {
    return next(error);
  }
});

// Recommendation: el reemplazo no confirmó a tiempo.
router.post('/deadline-missed', verifyJwt, allowRoles('service'), respond(publishDeadlineMissed));
// Recommendation (al confirmar un reemplazo): aviso al tripulante elegido.
router.post(
  '/assignment-replacement',
  verifyJwt,
  allowRoles('supervisor', 'super_admin', 'service'),
  respond(publishAssignmentReplacement)
);

module.exports = router;
