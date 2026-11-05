function permitirRoles(...roles) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }

    return next();
  };
}

module.exports = { permitirRoles };
