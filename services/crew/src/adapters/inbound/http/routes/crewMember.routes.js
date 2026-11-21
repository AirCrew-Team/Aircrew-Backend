const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const { findUsersByIds } = require('../../../outbound/clients/adminClient');
const {
  findCrewMembers,
  findCrewMemberByUserId,
} = require('../../../outbound/persistence/repositories/crewRepository');
const createGetCrewMembers = require('../../../../application/use-cases/getCrewMembers');
const createGetMyCrewProfile = require('../../../../application/use-cases/getMyCrewProfile');
const createAttachUserNames = require('../../../../application/use-cases/attachUserNames');
const createCrewMemberController = require('../controllers/crewMember.controller');

const router = express.Router();
const attachUserNames = createAttachUserNames(findUsersByIds);

const crewMemberController = createCrewMemberController({
  getCrewMembers: createGetCrewMembers(findCrewMembers, attachUserNames),
  getMyCrewProfile: createGetMyCrewProfile(findCrewMemberByUserId, attachUserNames),
});

// El alta de tripulantes la hace Admin (POST /users), que crea la cuenta y el perfil.
router.get('/', verifyJwt, allowRoles('supervisor', 'super_admin'), crewMemberController.list);
router.get('/me', verifyJwt, allowRoles('crew'), crewMemberController.me);

module.exports = router;
