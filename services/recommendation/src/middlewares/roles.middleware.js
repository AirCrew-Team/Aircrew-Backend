function permitirRoles(...roles) {
  return (req, res, next) => {
    // TODO: comprobar que req.usuario.rol está en roles
    next();
  };
}

module.exports = { permitirRoles };
