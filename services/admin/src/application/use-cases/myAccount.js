const { DomainError } = require('../../domain/errors');

// Encabezado del inicio: la base del usuario con sesión.
// La base del supervisor es la de sus datos laborales (users.base).
function createMyBase({ userRepository, baseRepository }) {
  return async function getMyBase(requester) {
    const user = await userRepository.findProfileById(requester.id);
    if (!user) throw new DomainError('Usuario no encontrado.', 404);

    const base = user.base ? await baseRepository.findBaseByCode(user.base) : null;
    if (!base) throw new DomainError('No tienes una base asignada.', 404, { code: 'no_base' });

    return {
      unit: base.unit,
      hq_code: base.hq_code,
      base_name: base.name,
      city: base.city,
      iata: base.code,
      icao: base.icao,
      operational_condition: base.operational_condition,
    };
  };
}

module.exports = createMyBase;
