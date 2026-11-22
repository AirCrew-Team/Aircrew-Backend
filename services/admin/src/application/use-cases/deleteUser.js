const { isValidUserId } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');

// Nombre de cada servicio en el mensaje del 502.
const SERVICE_LABELS = {
  flights: 'vuelos',
  notification: 'notificaciones',
  recommendation: 'recomendaciones',
  crew: 'tripulación',
};

// Eliminar una cuenta de forma definitiva (DELETE /users/:id/permanent). A diferencia
// de desactivar, se borra todo lo de la persona en cada servicio, en este orden:
//   1. flights: sus asignaciones. Los puestos de los vuelos que aún no salen quedan
//      vacantes y vuelven en la respuesta.
//   2. notification: una alerta «puesto vacante» a los supervisores por cada uno, y
//      después se borran sus avisos.
//   3. recommendation: las sugerencias de la IA que la nombran.
//   4. crew: perfil, certificaciones y ausencias.
//   5. admin: la cuenta (con foto y eventos de contraseña) y sus fallos de login.
// Los pasos son borrados que se pueden repetir: si un servicio falla, la cuenta
// sigue existiendo (502) y el super_admin reintenta; lo ya borrado no se deshace.
// Se llama a los cuatro servicios para cualquier rol: un supervisor no tiene vuelos
// ni perfil, y esos pasos devuelven 0.
function createDeleteUser({
  userRepository,
  crewClient,
  flightsClient,
  notificationClient,
  recommendationClient,
}) {
  return async function deleteUser(requester, id) {
    const target = isValidUserId(id) ? await userRepository.findById(id) : null;

    if (!target) {
      throw new DomainError('Usuario no encontrado.', 404);
    }

    if (target.id === requester.id) {
      throw new DomainError('No puedes eliminar tu propia cuenta.', 409, {
        code: 'cannot_delete_self',
      });
    }

    const lastSuperAdmin = () =>
      new DomainError('No se puede eliminar al último super_admin.', 409, {
        code: 'last_super_admin',
      });

    if (
      target.role === 'super_admin' &&
      (await userRepository.countActiveSuperAdminsExcept(target.id)) === 0
    ) {
      throw lastSuperAdmin();
    }

    const done = [];
    let unannounced = [];

    async function step(service, name, run) {
      try {
        const result = await run();
        done.push(name);
        return result;
      } catch (cause) {
        console.error(
          `Eliminar el usuario ${target.id}: falló ${name} (${cause.message}). Pasos hechos: ${
            done.join(', ') || 'ninguno'
          }.`
        );
        if (unannounced.length > 0) {
          console.error(
            `Eliminar el usuario ${target.id}: puestos vacantes sin aviso a los supervisores: ${unannounced
              .map((flight) => `${flight.flight_number} (${flight.flight_id})`)
              .join(', ')}.`
          );
        }
        throw new DomainError(
          `No se pudo eliminar el usuario: el servicio de ${SERVICE_LABELS[service]} no respondió. La cuenta sigue existiendo; vuelve a intentarlo.`,
          502,
          { code: 'user_delete_incomplete' }
        );
      }
    }

    const released = await step('flights', 'flights.releaseAssignments', () =>
      flightsClient.releaseAssignments(target.id)
    );
    const vacated = released.vacated_flights || [];

    unannounced = [...vacated];
    for (const flight of vacated) {
      await step('notification', `notification.publishSlotVacated ${flight.flight_number}`, () =>
        notificationClient.publishSlotVacated(flight)
      );
      unannounced.shift();
    }

    await step('notification', 'notification.deleteNotifications', () =>
      notificationClient.deleteNotifications(target.id)
    );
    await step('recommendation', 'recommendation.deleteSuggestions', () =>
      recommendationClient.deleteSuggestions(target.id)
    );
    await step('crew', 'crew.eraseUser', () => crewClient.eraseUser(target.id));

    // Al final, la cuenta. Vuelve a comprobar el último super_admin dentro de la
    // transacción por si otro super_admin se eliminó entretanto.
    if ((await userRepository.deleteUser(target.id)) === 'last_super_admin') {
      throw lastSuperAdmin();
    }

    return { id: target.id, vacated_flights: vacated };
  };
}

module.exports = createDeleteUser;
