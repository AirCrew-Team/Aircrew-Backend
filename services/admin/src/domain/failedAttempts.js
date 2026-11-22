const { DomainError } = require('./errors');

// Límite de intentos fallidos (D2): 5 en 15 min. En el login cuentan por correo
// normalizado, exista o no la cuenta; en el cambio de contraseña, por cuenta.
const FAILED_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

const MESSAGES = {
  // Igual exista o no la cuenta.
  login: 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.',
  changePassword:
    'Demasiados intentos con una contraseña actual incorrecta. Espera unos minutos e intenta de nuevo.',
};

function tooManyAttempts(message) {
  return new DomainError(message, 429);
}

module.exports = {
  FAILED_ATTEMPTS_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MESSAGES,
  tooManyAttempts,
};
