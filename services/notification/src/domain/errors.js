// Error de una regla del negocio. El errorHandler de shared lo convierte en
// { error, code?, field? } con el status indicado (por defecto 400).
// code: código fijo para el frontend · field: campo del formulario que falló.
class DomainError extends Error {
  constructor(message, status = 400, { code, field } = {}) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    if (code) this.code = code;
    if (field) this.field = field;
  }
}

module.exports = { DomainError };
