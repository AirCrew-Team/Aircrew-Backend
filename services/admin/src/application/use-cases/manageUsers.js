const {
  isCurrentSession,
  isValidUserId,
  parseUserListParams,
  normalizeSearchText,
  validateUserUpdate,
  validateLookupIds,
} = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');

function notFound() {
  return new DomainError('Usuario no encontrado.', 404);
}

// Fila de la pantalla Usuarios. Supervisor: sus datos laborales (de Admin).
// Tripulante: su perfil de Crew (null si Crew no respondió). super_admin: sin
// código, cargo, base, estado ni turno.
function toUserItem(user, crewProfile = null) {
  const isCrew = user.role === 'crew';
  const isSupervisor = user.role === 'supervisor';
  const profile = crewProfile || {};

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    pending_activation: user.pending_activation,
    created_at: user.created_at,
    phone: user.phone ?? null,
    employee_code: isCrew ? profile.employee_code ?? null : user.employee_code ?? null,
    position: isCrew ? profile.position ?? null : null,
    base: isCrew ? profile.base ?? null : user.base ?? null,
    status: isCrew
      ? profile.status ?? null
      : isSupervisor
        ? user.operational_status ?? null
        : null,
    shift: isSupervisor ? user.shift ?? null : null,
  };
}

// ¿El texto buscado aparece en el nombre, el correo, el código, la base o el cargo?
function matchesSearch(item, search) {
  return (
    !search ||
    [item.name, item.email, item.employee_code, item.base, item.position].some((value) =>
      normalizeSearchText(value).includes(search)
    )
  );
}

// Casos de uso de la administración de usuarios. Reciben el repositorio y el
// cliente de Crew por parámetro, así que no dependen de PostgreSQL ni de HTTP.
// resendInvitation: si se corrige el correo de una cuenta pendiente, la invitación se
// reenvía al correo nuevo y el enlace enviado al anterior deja de servir.
function createManageUsers(userRepository, { crewClient, resendInvitation } = {}) {
  async function findExisting(id) {
    const user = isValidUserId(id) ? await userRepository.findById(id) : null;

    if (!user) {
      throw notFound();
    }

    return user;
  }

  // Perfiles de Crew por user_id. Si Crew no responde, la lista sale sin ellos.
  async function loadCrewProfiles() {
    if (!crewClient) {
      return new Map();
    }

    try {
      const profiles = await crewClient.listProfiles();
      return new Map(profiles.map((profile) => [profile.user_id, profile]));
    } catch (error) {
      console.error(`No se pudieron cargar los perfiles de Crew: ${error.message}`);
      return new Map();
    }
  }

  // La cuenta del usuario del token, para restaurar la sesión al recargar.
  // Si ya no existe, está desactivada o el token es anterior al último cambio de
  // contraseña, la sesión deja de valer (401). El gateway consulta esta ruta antes de
  // cada petición y reenvía el 401: el code distingue la sesión anulada del token vencido.
  async function getCurrentUser(requester) {
    const user = isValidUserId(requester.id)
      ? await userRepository.findById(requester.id)
      : null;

    if (!isCurrentSession(user, requester)) {
      throw new DomainError('La sesión ya no es válida.', 401, { code: 'session_revoked' });
    }

    // La fecha solo sirve para la comprobación: la respuesta no cambia.
    const { password_changed_at: _changedAt, ...account } = user;
    return account;
  }

  async function loadItems(role = null) {
    const [users, profiles] = await Promise.all([
      userRepository.findUsers({ search: null, role }),
      loadCrewProfiles(),
    ]);

    return users.map((user) => toUserItem(user, profiles.get(user.id)));
  }

  // Lista paginada. Se filtra en memoria porque el código, el cargo y la base
  // de los tripulantes viven en Crew.
  async function listUsers(query) {
    const { page, pageSize, search, role } = parseUserListParams(query);
    const matches = (await loadItems(role)).filter((item) => matchesSearch(item, search));
    const start = (page - 1) * pageSize;

    return {
      items: matches.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total: matches.length,
    };
  }

  // Indicadores de la pantalla Usuarios y de la tarjeta «Gestión de Usuarios» del
  // inicio. «De guardia» suma tripulantes y supervisores on_duty; crew_available son
  // los tripulantes activos disponibles para un reemplazo. La aptitud médica no tiene
  // datos todavía: null.
  async function getUserStats() {
    const items = await loadItems();
    const byRole = { crew: 0, supervisor: 0, super_admin: 0 };

    for (const item of items) {
      byRole[item.role] += 1;
    }

    return {
      total: items.length,
      by_role: byRole,
      in_flight: items.filter((item) => item.role === 'crew' && item.status === 'in_flight').length,
      on_duty: items.filter((item) => item.status === 'on_duty').length,
      crew_available: items.filter(
        (item) => item.role === 'crew' && item.is_active && item.status === 'available'
      ).length,
      medical_fitness_percent: null,
    };
  }

  async function crewProfileOf(user) {
    if (user.role !== 'crew' || !crewClient) {
      return null;
    }

    try {
      return await crewClient.getProfile(user.id);
    } catch (error) {
      console.error(`No se pudo cargar el perfil de Crew de ${user.id}: ${error.message}`);
      return null;
    }
  }

  // Aplica los cambios en Crew y en Admin. Crew va primero porque es donde más
  // falla (código repetido); si después falla Admin, se devuelve Crew como estaba.
  async function applyChanges(target, { crewProfile, ...changes }) {
    const crewPatch = {
      ...crewProfile,
      ...(changes.isActive !== undefined && { is_active: changes.isActive }),
    };
    const touchesCrew = target.role === 'crew' && Object.keys(crewPatch).length > 0;
    let previousProfile = null;
    let profile = null;

    if (touchesCrew) {
      if (!crewClient) {
        throw new Error('Falta el cliente de Crew para editar un tripulante.');
      }
      previousProfile = await crewClient.getProfile(target.id);
      profile = await crewClient.updateProfile(target.id, crewPatch);
    }

    let updated;

    try {
      updated =
        Object.keys(changes).length > 0
          ? await userRepository.updateUser(target.id, changes)
          : await userRepository.findUserDetailById(target.id);
    } catch (error) {
      if (touchesCrew) {
        const revert = Object.fromEntries(
          Object.keys(crewPatch).map((key) => [key, previousProfile[key]])
        );
        await crewClient.updateProfile(target.id, revert).catch((revertError) =>
          console.error(`No se pudo devolver el perfil de Crew de ${target.id}:`, revertError)
        );
      }
      throw error;
    }

    return toUserItem(updated, profile || (await crewProfileOf(target)));
  }

  async function updateUser(requester, id, input) {
    const target = await findExisting(id);
    const changes = validateUserUpdate(requester, target, input);
    const updated = await applyChanges(target, changes);

    if (target.pending_activation && changes.email && changes.email !== target.email) {
      if (!resendInvitation) {
        throw new Error('Falta resendInvitation para reenviar la invitación al correo nuevo.');
      }
      try {
        await resendInvitation(target.id);
      } catch (cause) {
        const error = new Error(
          'Se cambió el correo, pero no se pudo enviar la invitación al correo nuevo. Usa «Reenviar invitación».',
          { cause }
        );
        error.status = 502;
        throw error;
      }
    }

    return updated;
  }

  // No se borra: ausencias y asignaciones guardan su id. Se desactiva, ya no
  // puede iniciar sesión y, si es tripulante, Crew deja de proponerlo.
  async function deactivateUser(requester, id) {
    const target = await findExisting(id);
    const changes = validateUserUpdate(requester, target, { is_active: false });
    return applyChanges(target, changes);
  }

  // Para otros servicios: nombres de varios usuarios en una consulta.
  function lookupUsers(input) {
    const ids = validateLookupIds(input && input.ids);
    return userRepository.findUsersByIds(ids);
  }

  return {
    getCurrentUser,
    listUsers,
    getUserStats,
    updateUser,
    deactivateUser,
    lookupUsers,
  };
}

module.exports = createManageUsers;
module.exports.toUserItem = toUserItem;
