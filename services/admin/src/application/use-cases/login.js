const { jwtSecret } = require('../../config/env');
const { canLogIn } = require('../../domain/entities/user');
const {
  FAILED_ATTEMPTS_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MESSAGES,
  tooManyAttempts,
} = require('../../domain/failedAttempts');
const { signSessionToken } = require('./sessionToken');

// Largo máximo de un correo (RFC 5321): uno más largo no se cuenta ni se guarda.
const MAX_EMAIL_LENGTH = 254;

// Hash bcrypt (coste 10, como passwordHasher) de un texto aleatorio que nadie conoce.
// Sin cuenta, o con una cuenta que no puede entrar, se compara contra él: la respuesta
// tarda lo mismo y no revela si el correo existe.
const TIMING_HASH = '$2a$10$hY16sWwG1qlCeIZaFRg8KOvniXpufGEGwjreX6bh3BDkudqrVjcGe';

// Cada intento se registra como fallo ANTES de comparar y se cuenta incluyéndolo: con
// más de 5 en 15 min responde 429 sin buscar la cuenta, con el mismo mensaje exista o
// no. Así, intentos simultáneos no pasan todos el límite antes de que se guarde alguno.
// El 429 y el login correcto borran su propio registro; los fallos anteriores quedan.
function createLogin({ userRepository, passwordHasher, now = () => new Date() }) {
  return async function login(input) {
    const { email, password } = input || {};

    if (
      typeof email !== 'string' ||
      !email.trim() ||
      email.trim().length > MAX_EMAIL_LENGTH ||
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
    const attemptId = await userRepository.recordLoginFailure(normalizedEmail);
    const failures = await userRepository.countLoginFailures({
      email: normalizedEmail,
      since: new Date(now().getTime() - FAILED_ATTEMPTS_WINDOW_MS),
    });

    if (failures > MAX_FAILED_ATTEMPTS) {
      await userRepository.deleteLoginFailure(attemptId);
      throw tooManyAttempts(MESSAGES.login);
    }

    const user = await userRepository.findByEmail(email.trim());
    const allowed = canLogIn(user);
    const matches = await passwordHasher.compare(password, allowed ? user.password_hash : TIMING_HASH);

    if (!allowed || !matches) {
      const error = new Error('Email o contraseña incorrectos.');
      error.status = 401;
      throw error;
    }

    await userRepository.deleteLoginFailure(attemptId);

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
module.exports.TIMING_HASH = TIMING_HASH;