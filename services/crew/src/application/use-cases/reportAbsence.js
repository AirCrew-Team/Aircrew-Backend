const { createAbsence } = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

const OVERLAP_MESSAGE =
  'Ya tienes una ausencia reportada que se cruza con esas fechas.';

function createReportAbsence({
  absenceRepository,
  notificationClient,
  now = () => new Date(),
}) {
  return async function reportAbsence(user, authorization, input) {
    const {
      start_date: startDate,
      end_date: endDate,
      reason,
      notes,
      attachment,
    } = input || {};
    // Todo se valida antes de abrir la transacción.
    const absence = createAbsence(
      { startDate, endDate, reason, notes, attachment },
      now()
    );

    // Con el tripulante bloqueado, dos envíos simultáneos van en fila y el
    // segundo ve la ausencia del primero. Ausencia y adjunto van juntos.
    const created = await absenceRepository.withCrewMemberLock(
      user.id,
      async (tx) => {
        const overlapping = await tx.hasOverlappingAbsence({
          crewUserId: user.id,
          startDate: absence.startDate,
          endDate: absence.endDate,
        });

        if (overlapping) {
          throw new DomainError(OVERLAP_MESSAGE, 409);
        }

        const row = await tx.insertAbsence({
          crewUserId: user.id,
          startDate: absence.startDate,
          endDate: absence.endDate,
          reason: absence.reason,
          notes: absence.notes,
        });
        const saved = absence.attachment
          ? await tx.insertAttachment({ absenceId: row.id, ...absence.attachment })
          : null;

        return { ...row, attachment: saved };
      }
    );

    // Alerta en tiempo real a los supervisores, con el código del tripulante.
    // No se espera: el tripulante recibe su respuesta aunque Notification tarde o falle.
    absenceRepository
      .findAbsenceById(created.id)
      .then((detail) =>
        notificationClient.notifyAbsenceReported(detail || created, authorization)
      )
      .catch((error) =>
        console.error(`No se pudo enviar la alerta de ausencia: ${error.message}`)
      );

    return created;
  };
}

module.exports = createReportAbsence;
