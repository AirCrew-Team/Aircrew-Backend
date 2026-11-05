function createGetUserByIdController(getUserById) {
  return async function getById(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required.' });
      }

      const canReadUser =
        req.user.role === 'super_admin' ||
        (req.user.role === 'crew' && req.user.id === req.params.id);

      if (!canReadUser) {
        return res.status(403).json({ error: 'Insufficient permissions.' });
      }

      const user = await getUserById(req.params.id);

      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
      }

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