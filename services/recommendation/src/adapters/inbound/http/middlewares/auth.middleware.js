function verifyJwt(req, res, next) {
  // TODO: leer Authorization Bearer, verificar JWT y asignar req.user
  next();
}

module.exports = { verifyJwt };
