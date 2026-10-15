function validar(esquema) {
  return (req, res, next) => {
    // TODO: validar req.body / params / query con zod
    next();
  };
}

module.exports = { validar };
