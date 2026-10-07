function verificarJwt(req, res, next) {
  // TODO: leer Authorization Bearer, verificar JWT y asignar req.usuario
  next();
}

module.exports = { verificarJwt };
