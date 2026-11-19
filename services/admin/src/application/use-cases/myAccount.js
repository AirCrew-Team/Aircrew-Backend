const {
  preferencesFor,
  validatePreferencesUpdate,
  validateProfileUpdate,
} = require('../../domain/entities/profile');
const { DomainError } = require('../../domain/errors');

// La cuenta del usuario con sesión: su base, su perfil y sus preferencias.
function createMyAccount({ userRepository, baseRepository }) {
  async function current(requester) {
    const user = await userRepository.findProfileById(requester.id);
    if (!user) throw new DomainError('Usuario no encontrado.', 404);
    return user;
  }

  // Encabezado del inicio: la base del usuario.
  async function getMyBase(requester) {
    const user = await current(requester);
    const base = user.base_code ? await baseRepository.findBaseByCode(user.base_code) : null;
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
  }

  async function getProfile(requester) {
    const user = await current(requester);
    return {
      id: user.id,
      full_name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      base: user.base_code,
      shift: user.shift,
      account_status: user.is_active ? 'active' : 'inactive',
      security: { last_password_change_at: user.password_changed_at },
    };
  }

  async function updateProfile(requester, input) {
    const changes = validateProfileUpdate(input);
    await userRepository.updateProfile(requester.id, changes);
    return getProfile(requester);
  }

  async function getPreferences(requester) {
    return preferencesFor(await current(requester));
  }

  async function updatePreferences(requester, input) {
    const user = await current(requester);
    const changes = validatePreferencesUpdate(user, input);
    const saved = await userRepository.mergePreferences(user.id, changes);
    return preferencesFor({ ...user, notification_preferences: saved });
  }

  return { getMyBase, getProfile, updateProfile, getPreferences, updatePreferences };
}

module.exports = createMyAccount;
