const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const notificationClient = require('../../../outbound/clients/notificationClient');
const { findUsersByIds } = require('../../../outbound/clients/adminClient');
const createAttachUserNames = require('../../../../application/use-cases/attachUserNames');
const absenceRepository = require('../../../outbound/persistence/repositories/absenceRepository');
const createReportAbsence = require('../../../../application/use-cases/reportAbsence');
const createGetAbsences = require('../../../../application/use-cases/getAbsences');
const createGetAbsenceById = require('../../../../application/use-cases/getAbsenceById');
const createGetAbsenceAttachment = require('../../../../application/use-cases/getAbsenceAttachment');
const createCoverAbsence = require('../../../../application/use-cases/coverAbsence');
const createAbsenceController = require('../controllers/absence.controller');

const router = express.Router();
const attachUserNames = createAttachUserNames(findUsersByIds);
const controller = createAbsenceController({
  reportAbsence: createReportAbsence({
    absenceRepository,
    notificationClient,
  }),
  getAbsences: createGetAbsences(absenceRepository, attachUserNames),
  getAbsenceById: createGetAbsenceById(absenceRepository, attachUserNames),
  getAbsenceAttachment: createGetAbsenceAttachment(absenceRepository),
  coverAbsence: createCoverAbsence(absenceRepository),
});

const supervisors = allowRoles('supervisor', 'super_admin');
// El comprobante viaja en base64 dentro del JSON. El body se lee después de
// comprobar la sesión y el rol (app.js no lo lee en esta ruta).
const absenceBody = express.json({ limit: '15mb' });

router.post('/', verifyJwt, allowRoles('crew'), absenceBody, controller.create);
router.get('/', verifyJwt, supervisors, controller.list);
router.get('/:id', verifyJwt, supervisors, controller.getById);
router.get('/:id/attachment', verifyJwt, supervisors, controller.downloadAttachment);
router.patch('/:id/cover', verifyJwt, supervisors, controller.cover);

module.exports = router;
