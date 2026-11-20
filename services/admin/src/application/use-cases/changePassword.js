const { isValidUserId } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const { validatePasswordChange } = require('../../domain/profile');
const {
  LIMIT_WINDOW_MS,
  MAX_CHANGES,
  MESSAGES,
  limitError,
} = require('../../domain/passwordReset');

function invalidSession() {
  return new DomainError('La sesión ya no es válida.', 401);
}

// 400 y no 401: el frontend cerraría la sesión con un 401.
function wrongPassword() {
  return new DomainError('La contraseña actual no es correcta.');
}

// Cambio de contraseña con sesión. Comparte con la recuperación el límite de
// 3 cambios en 24 h. No toca la cookie: la sesión sigue abierta.
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

    if (!user || user.is_active !== true) {
      throw invalidSession();
    }

    if (!(await passwordHasher.compare(currentPassword, user.password_hash))) {
      throw wrongPassword();
    }

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

      return { password_changed_at: passwordChangedAt };
    });
  };
}

module.exports = createChangePassword;
