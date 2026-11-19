// Respuesta de error común a todos los servicios:
// { error: "mensaje en español", code?: "codigo_fijo", field?: "campo" }
// code sirve para la lógica del frontend (no depende del texto) y field
// para marcar el campo del formulario.
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  console.error(`Error: ${err.message}`);

  const body = {
    error: status >= 500 && !err.status
      ? 'Error interno del servidor.'
      : err.message || 'Error interno del servidor.',
  };

  if (err.code && typeof err.code === 'string' && !/^[0-9A-Z]+$/.test(err.code)) {
    body.code = err.code;
  }

  if (err.field) {
    body.field = err.field;
  }

  res.status(status).json(body);
}

module.exports = { errorHandler };
