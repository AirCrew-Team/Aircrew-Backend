const { isCurrentSession, isValidUserId } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const { validatePasswordChange } = require('../../domain/profile');
const {
  LIMIT_WINDOW_MS,
  MAX_CHANGES,
  MESSAGES,
  limitError,
} = require('../../domain/passwordReset');
const {
  FAILED_ATTEMPTS_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MESSAGES: ATTEMPT_MESSAGES,
  tooManyAttempts,
} = require('../../domain/failedAttempts');
const { signSessionToken } = require('./sessionToken');

function invalidSession() {
  return new DomainError('La sesión ya no es válida.', 401);
}

// 400 y no 401: el frontend cerraría la sesión con un 401.
function wrongPassword() {
  return new DomainError('La contraseña actual no es correcta.');
}

// Cambio de contraseña con sesión. Comparte con la recuperación el límite de
// 3 cambios en 24 h, y con 5 contraseñas actuales incorrectas en 15 min responde 429
// sin comparar. Los tokens anteriores al cambio dejan de valer, así que devuelve
// un token nuevo para la cookie de esta sesión.
function createChangePassword({
  userRepository,
  passwordHasher,
  now = () => new Date(),
}) {
  return async function changePassword(requester, input) {
    const { currentPassword, newPassword } = validatePasswordChange(input);

    if (!isValidUserId(requester.id)) {
      throw invalidSession();
    }

    // bcrypt fuera del bloqueo: no retiene un cliente del pool mientras calcula.
    const user = await userRepository.findPasswordHash(requester.id);

    // Solo aquí se compara el iat: dentro del bloqueo, un envío doble de esta misma
    // sesión daría 401 y la cerraría. Un cambio intermedio ya lo detecta el hash.
    if (!isCurrentSession(user, requester)) {
      throw invalidSession();
    }

    // El intento se registra como fallo ANTES de comparar y se cuenta incluyéndolo:
    // cambios simultáneos no pasan todos el límite antes de que se guarde alguno. El
    // 429 y la contraseña actual correcta borran su propio registro.
    const attemptId = await userRepository.recordPasswordChangeFailure(requester.id);
    const failures = await userRepository.countPasswordResetEvents({
      userId: requester.id,
      event: 'change_failed',
      since: new Date(now().getTime() - FAILED_ATTEMPTS_WINDOW_MS),
    });

    if (failures > MAX_FAILED_ATTEMPTS) {
      await userRepository.deletePasswordChangeFailure(attemptId);
      throw tooManyAttempts(ATTEMPT_MESSAGES.changePassword);
    }

    if (!(await passwordHasher.compare(currentPassword, user.password_hash))) {
      throw wrongPassword();
    }

    await userRepository.deletePasswordChangeFailure(attemptId);

    const passwordHash = await passwordHasher.hash(newPassword);

    // Con la cuenta bloqueada solo se relee, se cuenta y se guarda. Si el hash cambió
    // mientras tanto, la contraseña actual que se comparó ya no es la vigente.
    return userRepository.withPasswordResetLock(requester.id, async (locked) => {
      const current = await locked.findPasswordHash(requester.id);

      if (!current || current.is_active !== true) {
        throw invalidSession();
      }

      if (current.password_hash !== user.password_hash) {
        throw wrongPassword();
      }

      const changes = await locked.countPasswordResetEvents({
        userId: requester.id,
        event: 'changed',
        since: new Date(now().getTime() - LIMIT_WINDOW_MS),
      });

      if (changes >= MAX_CHANGES) {
        throw limitError(MESSAGES.changes);
      }

      const passwordChangedAt = await locked.savePasswordChange({
        userId: requester.id,
        passwordHash,
      });

      // La fecha la pone PostgreSQL (NOW()). El iat nuevo no puede quedar antes de su
      // segundo aunque el reloj del servicio vaya atrás. Se firma dentro de la
      // transacción: si falla, el cambio se deshace.
      const issuedAt = Math.max(
        Math.floor(now().getTime() / 1000),
        Math.floor(new Date(passwordChangedAt).getTime() / 1000)
      );
      const token = signSessionToken({ id: requester.id, role: current.role }, { issuedAt });

      return { password_changed_at: passwordChangedAt, token };
    });
  };
}

module.exports = createChangePassword;
