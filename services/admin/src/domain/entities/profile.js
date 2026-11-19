const { DomainError } = require('../errors');

// Preferencias de notificación por rol, con su valor por defecto (activadas).
const DEFAULT_PREFERENCES = {
  crew: { urgent_replacement: true, gate_changes: true, certification_expiry: true },
  supervisor: { absence_alerts: true, ai_suggestions_ready: true, deadline_missed: true },
  super_admin: { absence_alerts: true, ai_suggestions_ready: true, deadline_missed: true },
};

const SHIFT_LABELS = { morning: 'Mañana', afternoon: 'Tarde', night: 'Noche' };
const e164Pattern = /^\+[1-9]\d{7,14}$/;

// Las preferencias guardadas encima de las de su rol (las nuevas salen activadas).
function preferencesFor(user) {
  const defaults = DEFAULT_PREFERENCES[user.role] || {};
  const saved = user.notification_preferences || {};
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, typeof saved[key] === 'boolean' ? saved[key] : defaults[key]])
  );
}

// Acepta cualquier subconjunto de las preferencias del rol, solo con true/false.
function validatePreferencesUpdate(user, input) {
  const allowed = Object.keys(DEFAULT_PREFERENCES[user.role] || {});
  const entries = Object.entries(input || {});

  if (entries.length === 0) {
    throw new DomainError(`Envía al menos una de: ${allowed.join(', ')}.`);
  }

  for (const [key, value] of entries) {
    if (!allowed.includes(key)) {
      throw new DomainError(`Preferencia desconocida: ${key}. Usa: ${allowed.join(', ')}.`, 400, { field: key });
    }
    if (typeof value !== 'boolean') {
      throw new DomainError(`${key} debe ser true o false.`, 400, { field: key });
    }
  }

  return Object.fromEntries(entries);
}

// Datos que el usuario puede cambiar de su propio perfil.
function validateProfileUpdate(input) {
  const { phone } = input || {};

  if (phone === undefined) {
    throw new DomainError('Envía phone.', 400, { field: 'phone' });
  }
  if (phone !== null && (typeof phone !== 'string' || !e164Pattern.test(phone.trim()))) {
    throw new DomainError('phone debe tener formato internacional, por ejemplo +573001234567.', 400, {
      field: 'phone',
    });
  }

  return { phone: phone === null ? null : phone.trim() };
}

module.exports = { preferencesFor, validatePreferencesUpdate, validateProfileUpdate, SHIFT_LABELS };
