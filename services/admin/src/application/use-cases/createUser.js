function createCreateUser({ userRepository, passwordHasher }) {
  return async function createUser(input) {
    const { name, email, password, role } = input || {};

    if (
      !name?.trim() ||
      !email?.trim() ||
      !password ||
      !role?.trim()
    ) {
      const error = new Error('Nombre, email, contraseña, y rol son requeridos.');
      error.status = 400;
      throw error;
    }

    const passwordHash = await passwordHasher.hash(password);

    return userRepository.create({
      name: name.trim(),
      email: email.trim(),
      passwordHash,
      role: role.trim(),
    });
  };
}

module.exports = createCreateUser;