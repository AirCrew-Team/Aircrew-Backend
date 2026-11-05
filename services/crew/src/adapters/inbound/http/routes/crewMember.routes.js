const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const { createUser } = require('../../../outbound/clients/adminClient');
const {
  createCrewMember: saveCrewMember,
} = require('../../../outbound/persistence/repositories/crewRepository');
const createCreateCrewMember = require('../../../../application/use-cases/createCrewMember');
const createCrewMemberController = require('../controllers/crewMember.controller');

const router = express.Router();

const createCrewMember = createCreateCrewMember({
  createUser,
  saveCrewMember,
});

const crewMemberController =
  createCrewMemberController(createCrewMember);

router.post('/', verifyJwt, allowRoles('supervisor', 'super_admin'), crewMemberController.create);

module.exports = router;