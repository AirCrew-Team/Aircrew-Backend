const crypto = require('node:crypto');
const {
  validatePasswordResetRequest,
  canResetPassword,
} = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const {
  RESET_TOKEN_EXPIRES_MS,
  LIMIT_WINDOW_MS,
  MAX_CHANGES,
  REQUEST_WAIT_MS,
  MAX_REQUESTS,
  MESSAGES,
  limitError,
} = require('../../domain/passwordReset');

// Pide el enlace para restablecer la contraseña. Responde lo mismo exista o no la
// cuenta; solo los límites (429) muestran otro mensaje. El correo se envía después de
// responder: runInBackground recibe la tarea del envío (los tests la ejecutan a mano).
function createRequestPasswordReset({
  userRepository,
  emailClient,
  now = () => new Date(),
  runInBackground = (task) => setImmediate(task),
}) {
  return async function requestPasswordReset(input) {
    const email = validatePasswordResetRequest(input || {});

    // Antes de buscar la cuenta: un correo mal configurado no se oculta tras el
    // mensaje genérico, y el 503 no revela si la cuenta existe. La ruta es pública:
    // el detalle (variables de entorno) va al log, no al cliente.
    try {
      emailClient.checkPasswordResetConfig();
    } catch (error) {
      console.error('El correo de recuperación no está configurado:', error);
      throw new DomainError(MESSAGES.emailUnavailable, 503);
    }

    const user = await userRepository.findByEmail(email);

    if (!canResetPassword(user)) {
      return { message: MESSAGES.generic };
    }

    const token = crypto.randomBytes(32).toString('hex');

    // Límites y guardado con la cuenta bloqueada: si llegan varias solicitudes a la
    // vez, la segunda espera y ya cuenta el evento de la primera.
    await userRepository.withPasswordResetLock(user.id, async (locked) => {
      const countSince = (event, ms) =>
        locked.countPasswordResetEvents({
          userId: user.id,
          event,
          since: new Date(now().getTime() - ms),
        });

      if ((await countSince('changed', LIMIT_WINDOW_MS)) >= MAX_CHANGES) {
        throw limitError(MESSAGES.changes);
      }

      if ((await countSince('requested', REQUEST_WAIT_MS)) > 0) {
        throw limitError(MESSAGES.wait);
      }

      if ((await countSince('requested', LIMIT_WINDOW_MS)) >= MAX_REQUESTS) {
        throw limitError(MESSAGES.requests);
      }

      await locked.savePasswordResetToken({
        userId: user.id,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(now().getTime() + RESET_TOKEN_EXPIRES_MS),
      });
    });

    // La tarea registra su propio fallo: nunca deja una promesa rechazada sin manejar.
    runInBackground(() =>
      emailClient
        .sendPasswordReset({ email: user.email, name: user.name, token })
        .catch((error) => {
          console.error(
            `No se pudo enviar el correo de recuperación a la cuenta ${user.id}:`,
            error
          );
        })
    );

    return { message: MESSAGES.generic };
  };
}

module.exports = createRequestPasswordReset;
