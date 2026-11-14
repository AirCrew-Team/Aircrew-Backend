function allowRoles(...roles) {
  return function authorizeRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Se requiere autenticación.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
    }

    return next();
  };
}

module.exports = { allowRoles };