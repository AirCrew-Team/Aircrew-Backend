const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const flightsClient = require('../../../outbound/clients/flightsClient');
const absenceRepository = require('../../../outbound/persistence/repositories/absenceRepository');
const createReportAbsence = require('../../../../application/use-cases/reportAbsence');
const createGetAbsences = require('../../../../application/use-cases/getAbsences');
const createAbsenceController = require('../controllers/absence.controller');

const router = express.Router();
const controller = createAbsenceController({
  reportAbsence: createReportAbsence({ flightsClient, absenceRepository }),
  getAbsences: createGetAbsences(absenceRepository),
});

router.post('/', verifyJwt, allowRoles('crew'), controller.create);
router.get(
  '/',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.list
);

module.exports = router;
