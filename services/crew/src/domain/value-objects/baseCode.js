const { DomainError } = require('../errors');

const basePattern = /^[A-Z]{3}$/;

// ?base=ATL de las pantallas del supervisor: código IATA en mayúsculas, o null
// si no viene. Un código que no es hub usa la zona por defecto (Nueva York).
function parseBase(base) {
  if (base === undefined || base === '') return null;
  const code = String(base).toUpperCase();
  if (!basePattern.test(code)) {
    throw new DomainError('base debe ser un código IATA de 3 letras, por ejemplo ATL.', 400, { field: 'base' });
  }
  return code;
}

module.exports = { parseBase };
