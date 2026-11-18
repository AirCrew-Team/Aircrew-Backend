const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const socketPublisher = require('../../../outbound/publishers/socketPublisher');
const {
  createAbsenceReportedAlert,
  createAbsenceCoveredAlert,
} = require('../../../../domain/alerts');
const createPublishAlert = require('../../../../application/use-cases/publishAlert');
const createEventController = require('../controllers/event.controller');

const router = express.Router();
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
  allowRoles('supervisor', 'super_admin'),
  controller.absenceCovered
);

module.exports = router;
