const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const { createUser } = require('../../../outbound/clients/adminClient');
const {
  createCrewMember: saveCrewMember,
  findCrewMembers,
} = require('../../../outbound/persistence/repositories/crewRepository');
const createCreateCrewMember = require('../../../../application/use-cases/createCrewMember');
const createGetCrewMembers = require('../../../../application/use-cases/getCrewMembers');
const createCrewMemberController = require('../controllers/crewMember.controller');

const router = express.Router();

const crewMemberController = createCrewMemberController({
  createCrewMember: createCreateCrewMember({ createUser, saveCrewMember }),
  getCrewMembers: createGetCrewMembers(findCrewMembers),
});

router.post('/', verifyJwt, allowRoles('supervisor', 'super_admin'), crewMemberController.create);
router.get('/', verifyJwt, allowRoles('supervisor', 'super_admin'), crewMemberController.list);

module.exports = router;
