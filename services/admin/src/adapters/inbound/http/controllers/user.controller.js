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

// Envuelve un caso de uso: lo ejecuta y responde con el status indicado.
function respond(status, run) {
  return async function handle(req, res, next) {
    try {
      return res.status(status).json(await run(req));
    } catch (error) {
      return next(error);
    }
  };
}

function createManageUsersController(manageUsers) {
  return {
    me: respond(200, (req) => manageUsers.getCurrentUser(req.user)),
    list: respond(200, (req) =>
      manageUsers.listUsers({ search: req.query.search, role: req.query.role })
    ),
    update: respond(200, (req) =>
      manageUsers.updateUser(req.user, req.params.id, req.body)
    ),
    deactivate: respond(200, (req) =>
      manageUsers.deactivateUser(req.user, req.params.id)
    ),
    lookup: respond(200, (req) => manageUsers.lookupUsers(req.body)),
  };
}

module.exports = {
  createGetUserByIdController,
  createCreateUserController,
  createCrewUserController,
  createManageUsersController,
};