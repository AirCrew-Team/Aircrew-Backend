function allowRoles(...roles) {
  return (req, res, next) => {
    // TODO: comprobar que req.user.role está en roles
    next();
  };
}

module.exports = { allowRoles };
