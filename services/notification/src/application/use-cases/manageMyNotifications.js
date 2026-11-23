const { DomainError } = require('../../domain/errors');

const DEFAULT_LIMIT = 20;
const ALWAYS_IN_BELL = ['assignment:replacement'];
const MAX_LIMIT = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new DomainError('Notificación no encontrada.', 404);
}

// La campana: los avisos de la persona con sesión y las alertas de su rol
// (los supervisores ven las de ausencias). Cada uno marca como leídos solo los suyos.
function toItem(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    data: row.data,
    read: row.read_at !== null,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

// loadDisabledTypes(user, token): tipos que la persona apagó en sus preferencias; la
// lista y el contador de no leídos los excluyen. Sin él no se excluye nada.
function createManageMyNotifications({ notificationRepository, loadDisabledTypes = async () => [] }) {
  async function listMine(user, { limit, token } = {}) {
    const size = limit === undefined || limit === '' ? DEFAULT_LIMIT : Number(limit);

    if (!Number.isInteger(size) || size < 1 || size > MAX_LIMIT) {
      throw new DomainError(`limit debe ser un entero de 1 a ${MAX_LIMIT}.`);
    }

    // La asignación de reemplazo tiene un plazo para dar «Enterado»: la preferencia
    // solo silencia el aviso en vivo; en la campana queda siempre.
    const excludeTypes = (await loadDisabledTypes(user, token)).filter(
      (type) => !ALWAYS_IN_BELL.includes(type)
    );
    const [rows, unread] = await Promise.all([
      notificationRepository.findVisible(user, { limit: size, excludeTypes }),
      notificationRepository.countUnread(user, { excludeTypes }),
    ]);

    return { items: rows.map(toItem), unread_count: unread };
  }

  async function markRead(user, id) {
    const row =
      typeof id === 'string' && uuidPattern.test(id)
        ? await notificationRepository.markRead(user, id)
        : null;

    if (!row) {
      throw notFound();
    }

    return toItem(row);
  }

  async function markAllRead(user) {
    return { updated: await notificationRepository.markAllRead(user) };
  }

  return { listMine, markRead, markAllRead };
}

module.exports = createManageMyNotifications;
