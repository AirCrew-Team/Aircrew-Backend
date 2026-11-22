const { adminServiceUrl } = require('../../../config/env');
const { disabledAlertTypes } = require('../../../domain/alerts');

// Cuánto se guardan las preferencias de cada persona y cuánto se espera a admin.
const PREFERENCES_TTL_MS = 60000;
const TIMEOUT_MS = 2000;
// Tope de sesiones guardadas: al llegar, sale la más antigua.
const MAX_ENTRIES = 5000;

// Lee de admin (GET /users/me, con el token de la propia persona) los tipos de alerta
// que apagó y los guarda 60 s por token (por sesión: la sesión nueva de una persona no
// tapa el 401 de una anulada). Nunca falla: si admin no responde o responde distinto
// de 200, no se filtra nada (mejor recibir de más que perder una alerta), queda en el
// log y no se guarda, para volver a preguntar la próxima vez. Con un 401 (sesión
// anulada) llama además a onUnauthorized, si se pasa: el SSE la cierra.
function createPreferencesLoader({
  baseUrl = adminServiceUrl,
  fetchImpl = fetch,
  ttlMs = PREFERENCES_TTL_MS,
  timeoutMs = TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();

  return async function loadDisabledTypes(user, token, { onUnauthorized } = {}) {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > now()) return cached.types;

    try {
      const response = await fetchImpl(`${baseUrl}/users/me`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 401 && onUnauthorized) onUnauthorized();

      if (!response.ok) {
        throw new Error(`Admin respondió ${response.status}`);
      }

      const profile = await response.json();
      const types = disabledAlertTypes(profile && profile.notifications);
      cache.delete(token);
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(token, { types, expiresAt: now() + ttlMs });
      return types;
    } catch (error) {
      console.error(
        `No se pudieron leer las preferencias de notificaciones de ${user.id}; se envía todo: ${error.message}`
      );
      return [];
    }
  };
}

module.exports = { createPreferencesLoader, loadDisabledTypes: createPreferencesLoader() };
