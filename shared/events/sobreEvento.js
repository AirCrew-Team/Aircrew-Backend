const crypto = require('crypto');

function crearSobreEvento({ tipo, payload, correlationId }) {
  return {
    id: crypto.randomUUID(),
    tipo,
    fecha: new Date().toISOString(),
    correlationId: correlationId || crypto.randomUUID(),
    payload,
  };
}

module.exports = { crearSobreEvento };
