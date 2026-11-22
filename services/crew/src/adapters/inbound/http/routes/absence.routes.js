const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const notificationClient = require('../../../outbound/clients/notificationClient');
const flightsClient = require('../../../outbound/clients/flightsClient');
const recommendationClient = require('../../../outbound/clients/recommendationClient');
const { findUsersByIds } = require('../../../outbound/clients/adminClient');
const createAttachUserNames = require('../../../../application/use-cases/attachUserNames');
const absenceRepository = require('../../../outbound/persistence/repositories/absenceRepository');
const { findCrewMemberByUserId } = require('../../../outbound/persistence/repositories/crewRepository');
const createReportAbsence = require('../../../../application/use-cases/reportAbsence');
const createGetAbsences = require('../../../../application/use-cases/getAbsences');
const createGetMyAbsences = require('../../../../application/use-cases/getMyAbsences');
const createGetAbsenceById = require('../../../../application/use-cases/getAbsenceById');
const createGetAbsenceAttachment = require('../../../../application/use-cases/getAbsenceAttachment');
const createCoverAbsence = require('../../../../application/use-cases/coverAbsence');
const createUpdateSuggestionsState = require('../../../../application/use-cases/updateSuggestionsState');
const createAbsenceWorkflow = require('../../../../application/use-cases/absenceWorkflow');
const createAbsenceController = require('../controllers/absence.controller');

const router = express.Router();
const attachUserNames = createAttachUserNames(findUsersByIds);
const controller = createAbsenceController({
  reportAbsence: createReportAbsence({
    absenceRepository,
    notificationClient,
    flightsClient,
    recommendationClient,
    findCrewMemberByUserId,
  }),
  getAbsences: createGetAbsences(absenceRepository, attachUserNames, flightsClient),
  getMyAbsences: createGetMyAbsences({ absenceRepository, findCrewMemberByUserId }),
  getAbsenceById: createGetAbsenceById(absenceRepository, attachUserNames),
  getAbsenceAttachment: createGetAbsenceAttachment(absenceRepository),
  coverAbsence: createCoverAbsence(absenceRepository),
  updateSuggestionsState: createUpdateSuggestionsState(absenceRepository),
  workflow: createAbsenceWorkflow({ absenceRepository, attachUserNames, notificationClient }),
});

const supervisors = allowRoles('supervisor', 'super_admin');
// El comprobante viaja en base64 dentro del JSON. El body se lee después de
// comprobar la sesión y el rol (app.js no lo lee en esta ruta).
const absenceBody = express.json({ limit: '15mb' });

router.post('/', verifyJwt, allowRoles('crew'), absenceBody, controller.create);
router.get('/', verifyJwt, supervisors, controller.list);
// Rutas fijas antes de /:id para que Express no las tome como un id.
router.get('/me', verifyJwt, allowRoles('crew'), controller.mine);
router.get('/tracking', verifyJwt, supervisors, controller.tracking);
router.get('/stats', verifyJwt, supervisors, controller.stats);
// Internas (token de servicio).
router.get('/expired', verifyJwt, allowRoles('service'), controller.expired);
router.post('/acknowledged', verifyJwt, allowRoles('service'), controller.acknowledged);
router.get('/:id', verifyJwt, allowRoles('supervisor', 'super_admin', 'service'), controller.getById);
router.get('/:id/attachment', verifyJwt, supervisors, controller.downloadAttachment);
router.patch('/:id/cover', verifyJwt, supervisors, controller.cover);
// El supervisor confirmó un reemplazo: queda esperando su «Enterado».
router.patch('/:id/approve', verifyJwt, supervisors, controller.approve);
// Interno: el reemplazo dejó vencer el plazo.
router.patch('/:id/missed', verifyJwt, allowRoles('service'), controller.missed);
// Interno: Recommendation informa el resultado de la búsqueda de reemplazos.
router.patch('/:id/suggestions', verifyJwt, allowRoles('service'), controller.updateSuggestions);

module.exports = router;
