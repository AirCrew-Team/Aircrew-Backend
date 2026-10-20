const express = require('express');

const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const passwordHasher = require('../../../outbound/security/passwordHasher');

const createGetUserById = require('../../../../application/use-cases/getUserById');
const createCreateUser = require('../../../../application/use-cases/createUser');

const {
  createGetUserByIdController,
  createCreateUserController,
} = require('../controllers/user.controller');

const router = express.Router();

const getUserById = createGetUserById(userRepository);
const createUser = createCreateUser({ userRepository, passwordHasher });

const getByIdController = createGetUserByIdController(getUserById);
const createUserController = createCreateUserController(createUser);

router.get('/:id', getByIdController);
router.post('/', createUserController);

module.exports = router;