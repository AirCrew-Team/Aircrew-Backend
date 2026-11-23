const { DomainError } = require('./errors');

// Reglas de la recuperación de contraseña. Son del producto, no del entorno.
const MINUTE = 60 * 1000;
const RESET_TOKEN_EXPIRES_MS = 10 * MINUTE;
const LIMIT_WINDOW_MS = 24 * 60 * MINUTE;
const MAX_CHANGES = 3;
const REQUEST_WAIT_MS = 2 * MINUTE;
const MAX_REQUESTS = 5;

const MESSAGES = {
  generic:
    'Si el correo corresponde a una cuenta activa, te enviamos un enlace para restablecer la contraseña.',
  changes:
    'Ya cambiaste tu contraseña 3 veces en las últimas 24 horas. Podrás cambiarla de nuevo más tarde.',
  wait: 'Ya te enviamos un enlace hace poco. Revisa tu correo (también la carpeta de spam) o espera 2 minutos para pedir otro.',
  requests:
    'Alcanzaste el límite de 5 solicitudes en 24 horas. Intenta de nuevo más tarde.',
  invalidLink:
    'El enlace para restablecer la contraseña no es válido o ya venció.',
  emailUnavailable: 'El servicio de correo no está disponible. Intenta más tarde.',
};

function limitError(message) {
  return new DomainError(message, 429);
}

module.exports = {
  RESET_TOKEN_EXPIRES_MS,
  LIMIT_WINDOW_MS,
  MAX_CHANGES,
  REQUEST_WAIT_MS,
  MAX_REQUESTS,
  MESSAGES,
  limitError,
};
