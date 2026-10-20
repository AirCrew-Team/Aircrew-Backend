function createGetUserByIdController(getUserById) {
  return async function getById(req, res, next) {
    try {
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

module.exports = {
  createGetUserByIdController,
  createCreateUserController,
};