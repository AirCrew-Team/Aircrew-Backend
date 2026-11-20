const { jwtSecret } = require('../../config/env');
const { canLogIn } = require('../../domain/entities/user');
const { signSessionToken } = require('./sessionToken');

function createLogin({ userRepository, passwordHasher }) {
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

    const user = await userRepository.findByEmail(email.trim());

    if (
      !canLogIn(user) ||
      !(await passwordHasher.compare(password, user.password_hash))
    ) {
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