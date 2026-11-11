// Error de una regla del negocio. `status` lo usa el errorHandler de shared
// para responder; por defecto 400 (datos que no cumplen la regla).
class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
  }
}

module.exports = { DomainError };
