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

function createResendInvitationController(resendInvitation) {
  return async function resend(req, res, next) {
    try {
      return res.status(200).json(await resendInvitation(req.params.id));
    } catch (error) {
      return next(error);
    }
  };
}

function createDeleteUserController(deleteUser) {
  return async function remove(req, res, next) {
    try {
      return res.status(200).json(await deleteUser(req.user, req.params.id));
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
      manageUsers.listUsers({
        page: req.query.page,
        page_size: req.query.page_size,
        search: req.query.search,
        role: req.query.role,
      })
    ),
    stats: respond(200, () => manageUsers.getUserStats()),
    update: respond(200, (req) =>
      manageUsers.updateUser(req.user, req.params.id, req.body)
    ),
    deactivate: respond(200, (req) =>
      manageUsers.deactivateUser(req.user, req.params.id)
    ),
    lookup: respond(200, (req) => manageUsers.lookupUsers(req.body)),
  };
}

// Perfil y foto de la propia cuenta: siempre sobre req.user.
function createProfileController(manageProfile) {
  async function photo(req, res, next) {
    try {
      const { mime_type: mimeType, data } = await manageProfile.getPhoto(req.user);
      res.set({
        'Content-Type': mimeType,
        'X-Content-Type-Options': 'nosniff',
        // El <img> vuelve a preguntar; la URL cambia con ?v= al subir otra.
        'Cache-Control': 'private, no-cache',
      });
      return res.status(200).send(data);
    } catch (error) {
      return next(error);
    }
  }

  async function deletePhoto(req, res, next) {
    try {
      await manageProfile.deletePhoto(req.user);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  }

  return {
    me: respond(200, (req) => manageProfile.getMyProfile(req.user)),
    update: respond(200, (req) => manageProfile.updateMyProfile(req.user, req.body)),
    savePhoto: respond(200, (req) => manageProfile.savePhoto(req.user, req.body)),
    photo,
    deletePhoto,
  };
}

module.exports = {
  createResendInvitationController,
  createGetUserByIdController,
  createCreateUserController,
  createManageUsersController,
  createProfileController,
  createDeleteUserController,
};