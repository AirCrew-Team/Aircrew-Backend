const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const flightsClient = require('../../../outbound/clients/flightsClient');
const notificationClient = require('../../../outbound/clients/notificationClient');
const recommendationClient = require('../../../outbound/clients/recommendationClient');
const { findUsersByIds } = require('../../../outbound/clients/adminClient');
const createAttachUserNames = require('../../../../application/use-cases/attachUserNames');
const absenceRepository = require('../../../outbound/persistence/repositories/absenceRepository');
const createReportAbsence = require('../../../../application/use-cases/reportAbsence');
const createGetAbsences = require('../../../../application/use-cases/getAbsences');
const createGetAbsenceById = require('../../../../application/use-cases/getAbsenceById');
const createCoverAbsence = require('../../../../application/use-cases/coverAbsence');
const createUpdateSuggestionsState = require('../../../../application/use-cases/updateSuggestionsState');
const createAbsenceController = require('../controllers/absence.controller');

const router = express.Router();
const attachUserNames = createAttachUserNames(findUsersByIds);
const controller = createAbsenceController({
  reportAbsence: createReportAbsence({
    flightsClient,
    absenceRepository,
    notificationClient,
    recommendationClient,
  }),
  getAbsences: createGetAbsences(absenceRepository, attachUserNames),
  getAbsenceById: createGetAbsenceById(absenceRepository, attachUserNames),
  coverAbsence: createCoverAbsence(absenceRepository),
  updateSuggestionsState: createUpdateSuggestionsState(absenceRepository),
});

const supervisors = allowRoles('supervisor', 'super_admin');

router.post('/', verifyJwt, allowRoles('crew'), controller.create);
router.get('/', verifyJwt, supervisors, controller.list);
router.get('/:id', verifyJwt, allowRoles('supervisor', 'super_admin', 'service'), controller.getById);
router.patch('/:id/cover', verifyJwt, supervisors, controller.cover);
// Interno: Recommendation informa el resultado de la búsqueda de reemplazos.
router.patch('/:id/suggestions', verifyJwt, allowRoles('service'), controller.updateSuggestions);

module.exports = router;
