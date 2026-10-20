function createGetUserById(userRepository) {
  return async function getUserById(id) {
    return userRepository.findById(id);
  };
}

module.exports = createGetUserById;
