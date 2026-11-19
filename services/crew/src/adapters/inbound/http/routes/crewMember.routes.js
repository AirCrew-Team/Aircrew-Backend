const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const { createUser, findUsersByIds } = require('../../../outbound/clients/adminClient');
const {
  createCrewMember: saveCrewMember,
  findCrewMembers,
  findCrewMemberByUserId,
} = require('../../../outbound/persistence/repositories/crewRepository');
const createCreateCrewMember = require('../../../../application/use-cases/createCrewMember');
const createGetCrewMembers = require('../../../../application/use-cases/getCrewMembers');
const createGetMyCrewProfile = require('../../../../application/use-cases/getMyCrewProfile');
const createAttachUserNames = require('../../../../application/use-cases/attachUserNames');
const createCrewMemberController = require('../controllers/crewMember.controller');
const { myMetrics } = require('./shift.routes');

const router = express.Router();
const attachUserNames = createAttachUserNames(findUsersByIds);

const crewMemberController = createCrewMemberController({
  createCrewMember: createCreateCrewMember({ createUser, saveCrewMember }),
  getCrewMembers: createGetCrewMembers(findCrewMembers, attachUserNames),
  getMyCrewProfile: createGetMyCrewProfile(findCrewMemberByUserId, attachUserNames),
});

router.post('/', verifyJwt, allowRoles('supervisor', 'super_admin'), crewMemberController.create);
router.get('/', verifyJwt, allowRoles('supervisor', 'super_admin', 'service'), crewMemberController.list);
router.get('/me', verifyJwt, allowRoles('crew'), crewMemberController.me);
// Métricas de Mis Vuelos: horas del mes, descanso y sectores.
router.get('/me/metrics', verifyJwt, allowRoles('crew'), myMetrics);

module.exports = router;
