const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const { findUsersByIds } = require('../../../outbound/clients/adminClient');
const { notifyCertification } = require('../../../outbound/clients/notificationClient');
const certificationRepository = require('../../../outbound/persistence/repositories/certificationRepository');
const createManageCertifications = require('../../../../application/use-cases/manageCertifications');
const createCertificationController = require('../controllers/certification.controller');

// Pantalla Certificaciones: todo es solo del super_admin. El supervisor y el
// tripulante reciben 403.
const router = express.Router();
const controller = createCertificationController(
  createManageCertifications({ certificationRepository, findUsersByIds, notifyCertification })
);

const superAdmin = allowRoles('super_admin');
// La copia viaja en base64 dentro del JSON (5 MB ≈ 6,7 MB en base64). El body se
// lee después de comprobar la sesión y el rol (app.js no lo lee en esta ruta).
const certificationBody = express.json({ limit: '8mb' });

router.use(verifyJwt, superAdmin);

// Rutas fijas antes de /:userId.
router.get('/options', controller.options);
router.get('/stats', controller.stats);
router.get('/uncertified', controller.uncertified);
router.get('/', controller.list);
router.get('/:userId', controller.getById);
router.get('/:userId/file', controller.downloadFile);
router.put('/:userId', certificationBody, controller.save);
router.delete('/:userId', controller.remove);

module.exports = router;
