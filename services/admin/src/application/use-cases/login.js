const { jwtSecret } = require('../../config/env');
const { canLogIn } = require('../../domain/entities/user');
const {
  FAILED_ATTEMPTS_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MESSAGES,
  tooManyAttempts,
} = require('../../domain/failedAttempts');
const { signSessionToken } = require('./sessionToken');

// Con 5 fallos de un correo en 15 min responde 429 sin buscar la cuenta, con el mismo
// mensaje exista o no. Un login correcto no borra los fallos anteriores.
function createLogin({ userRepository, passwordHasher, now = () => new Date() }) {
  return async function login(input) {
    const { email, password } = input || {};

    if (
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      !password
    ) {
      const error = new Error('Se requieren email y password.');
      error.status = 400;
      throw error;
    }

    if (!jwtSecret) {
      const error = new Error('JWT_SECRET no está configurado.');
      error.status = 500;
      throw error;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const failures = await userRepository.countLoginFailures({
      email: normalizedEmail,
      since: new Date(now().getTime() - FAILED_ATTEMPTS_WINDOW_MS),
    });

    if (failures >= MAX_FAILED_ATTEMPTS) {
      throw tooManyAttempts(MESSAGES.login);
    }

    const user = await userRepository.findByEmail(email.trim());

    if (
      !canLogIn(user) ||
      !(await passwordHasher.compare(password, user.password_hash))
    ) {
      await userRepository.recordLoginFailure(normalizedEmail);
      const error = new Error('Email o contraseña incorrectos.');
      error.status = 401;
      throw error;
    }

    // El iat no puede quedar antes del último cambio de contraseña (lo fija PostgreSQL):
    // si el reloj del servicio va atrás, la sesión recién abierta daría 401 en /auth/me.
    const changedAt = user.password_changed_at
      ? Math.floor(new Date(user.password_changed_at).getTime() / 1000)
      : 0;
    const issuedAt = Math.max(Math.floor(Date.now() / 1000), changedAt);
    const token = signSessionToken(user, { issuedAt });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    };
  };
}

module.exports = createLogin;