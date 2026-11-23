const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const aircraftRepository = require('../../../outbound/persistence/repositories/aircraftRepository');
const createManageAircraft = require('../../../../application/use-cases/manageAircraft');
const createAircraftController = require('../controllers/aircraft.controller');

const router = express.Router();
const controller = createAircraftController(createManageAircraft({ aircraftRepository }));

const superAdmin = allowRoles('super_admin');
// La foto viaja en base64 dentro del JSON. El body se lee después de comprobar
// la sesión y el rol (app.js no lo lee en esta ruta).
const photoBody = express.json({ limit: '3mb' });

// La flota es solo del super_admin. Las rutas fijas van antes de /:id.
router.get('/operating', verifyJwt, superAdmin, controller.listOperating);
router.get('/stats', verifyJwt, superAdmin, controller.stats);
router.get('/options', verifyJwt, superAdmin, controller.options);
router.get('/manifest', verifyJwt, superAdmin, controller.manifest);
router.get('/', verifyJwt, superAdmin, controller.list);
router.post('/', verifyJwt, superAdmin, controller.create);
router.put('/:id', verifyJwt, superAdmin, controller.update);
router.delete('/:id', verifyJwt, superAdmin, controller.remove);
router.get('/:id/report', verifyJwt, superAdmin, controller.report);
router.patch('/:id/maintenance/tasks/:index', verifyJwt, superAdmin, controller.setTask);
router.post('/:id/release', verifyJwt, superAdmin, controller.release);
router.get('/:id/photo', verifyJwt, superAdmin, controller.photo);
router.put('/:id/photo', verifyJwt, superAdmin, photoBody, controller.savePhoto);
router.delete('/:id/photo', verifyJwt, superAdmin, controller.deletePhoto);

module.exports = router;
