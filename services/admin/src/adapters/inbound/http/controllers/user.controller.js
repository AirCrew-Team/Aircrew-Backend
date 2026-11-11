function createGetUserByIdController(getUserById) {
  return async function getById(req, res, next) {
    try {
      const user = await getUserById(req.user, req.params.id);
      return res.status(200).json(user);
    } catch (error) {
      return next(error);
    }
  };
}

function createCreateUserController(createUser) {
  return async function create(req, res, next) {
    try {
      const user = await createUser(req.body);
      return res.status(201).json(user);
    } catch (error) {
      return next(error);
    }
  };
}

function createCrewUserController(inviteCrewUser) {
  return async function createCrewUser(req, res, next) {
    try {
      const user = await inviteCrewUser(req.body);
      return res.status(201).json(user);
    } catch (error) {
      return next(error);
    }
  };
}


module.exports = {
  createGetUserByIdController,
  createCreateUserController,
  createCrewUserController,
};