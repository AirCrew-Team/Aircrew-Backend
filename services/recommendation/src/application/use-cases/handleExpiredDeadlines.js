// Revisión de plazos de «Enterado» (corre cada minuto en segundo plano):
// por cada ausencia esperando confirmación con el plazo vencido,
// 1. Flights quita al reemplazo y el puesto vuelve a quedar como antes.
//    Si ya no hay nada que deshacer, es porque sí dio «Enterado» (y el aviso
//    a Crew se perdió): entonces se marca como cubierta.
// 2. Crew devuelve la ausencia a la cola (reported) y lo anota en la línea de tiempo.
// 3. El candidato queda "missed" y no se le vuelve a proponer.
// 4. Los supervisores reciben absence:deadline_missed con la siguiente opción.
// Todo con token de servicio: no hay un usuario detrás.
function createHandleExpiredDeadlines({
  crewClient,
  flightsClient,
  suggestionRepository,
  notificationClient,
  serviceAuthorization,
}) {
  async function handleOne(absence, members) {
    const auth = serviceAuthorization();

    try {
      await flightsClient.revertReplacement(absence.flight_id, absence.replacement_user_id, auth);
    } catch (error) {
      if (error.code === 'nothing_to_revert') {
        await crewClient.markAcknowledged(
          { flightId: absence.flight_id, replacementUserId: absence.replacement_user_id },
          auth
        );
        return 'acknowledged';
      }
      throw error;
    }

    const missed = await crewClient.markMissed(absence.id, auth);
    await suggestionRepository.markStatus(absence.id, absence.replacement_user_id, 'missed');

    const next = await suggestionRepository.findNextProposed(absence.id);
    const nameOf = (userId) => (members.find((m) => m.user_id === userId) || {}).name || null;

    await notificationClient.notifyDeadlineMissed(
      {
        absence_id: absence.id,
        flight_number: absence.flight_number,
        candidate_name: missed.missed_name || nameOf(absence.replacement_user_id),
        next_candidate_name: next ? nameOf(next.crew_user_id) : null,
      },
      auth
    );

    return 'missed';
  }

  return async function handleExpiredDeadlines() {
    const auth = serviceAuthorization();
    const expired = await crewClient.getExpiredAbsences(auth);
    if (expired.length === 0) return { checked: 0 };

    const members = await crewClient.getCrewMembers(auth);
    const results = [];

    for (const absence of expired) {
      try {
        results.push(await handleOne(absence, members));
      } catch (error) {
        console.error(`No se pudo procesar el plazo vencido de ${absence.id}: ${error.message}`);
      }
    }

    return { checked: expired.length, results };
  };
}

module.exports = createHandleExpiredDeadlines;
