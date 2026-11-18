const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const flightsClient = require('../../../outbound/clients/flightsClient');
const absenceRepository = require('../../../outbound/persistence/repositories/absenceRepository');
const createReportAbsence = require('../../../../application/use-cases/reportAbsence');
const createGetAbsences = require('../../../../application/use-cases/getAbsences');
const createGetAbsenceById = require('../../../../application/use-cases/getAbsenceById');
const createCoverAbsence = require('../../../../application/use-cases/coverAbsence');
const createAbsenceController = require('../controllers/absence.controller');

const router = express.Router();
const controller = createAbsenceController({
  reportAbsence: createReportAbsence({ flightsClient, absenceRepository }),
  getAbsences: createGetAbsences(absenceRepository),
  getAbsenceById: createGetAbsenceById(absenceRepository),
  coverAbsence: createCoverAbsence(absenceRepository),
});

const supervisors = allowRoles('supervisor', 'super_admin');

router.post('/', verifyJwt, allowRoles('crew'), controller.create);
router.get('/', verifyJwt, supervisors, controller.list);
router.get('/:id', verifyJwt, supervisors, controller.getById);
router.patch('/:id/cover', verifyJwt, supervisors, controller.cover);

module.exports = router;
