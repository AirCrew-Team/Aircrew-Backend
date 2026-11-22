// Respuesta de error común a todos los servicios:
// { error: "mensaje en español", code?: "codigo_fijo", field?: "campo" }
// code sirve para la lógica del frontend (no depende del texto) y field
// para marcar el campo del formulario.

// Errores de express.json (body-parser), que traen el mensaje en inglés.
const BODY_ERRORS = {
  'entity.too.large': {
    status: 413,
    error: 'El cuerpo de la petición supera el tamaño permitido.',
    code: 'payload_too_large',
  },
  'entity.parse.failed': {
    status: 400,
    error: 'El cuerpo de la petición no es un JSON válido.',
    code: 'invalid_json',
  },
};

function errorHandler(err, req, res, next) {
  console.error(`Error: ${err.message}`);

  // hasOwn: un type como «constructor» no debe encontrar Object.prototype.
  if (Object.hasOwn(BODY_ERRORS, String(err.type))) {
    const { status, error, code } = BODY_ERRORS[err.type];
    return res.status(status).json({ error, code });
  }

  const status = err.status || 500;

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
