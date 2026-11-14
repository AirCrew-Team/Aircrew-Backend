// Política de contraseñas: de 12 a 72 bytes UTF-8.
// 72 es el máximo que bcrypt usa; lo que pase de ahí se ignoraría sin avisar.
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

function isValidPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
  );
}

module.exports = { isValidPassword };
