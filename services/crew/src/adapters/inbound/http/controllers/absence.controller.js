const { attachmentDisposition } = require('./contentDisposition');

function createAbsenceController({
  reportAbsence,
  getAbsences,
  getMyAbsences,
  getAbsenceById,
  getAbsenceAttachment,
  coverAbsence,
  updateSuggestionsState,
  workflow,
}) {
  // Envuelve un caso de uso: lo ejecuta y responde con el status indicado.
  const respond = (status, run) => async (req, res, next) => {
    try {
      const result = await run(req);
      return status === 204 ? res.status(204).end() : res.status(status).json(result);
    } catch (error) {
      return next(error);
    }
  };

  async function create(req, res, next) {
    try {
      const absence = await reportAbsence(
        req.user,
        req.headers.authorization,
        req.body
      );
      return res.status(201).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  async function list(req, res, next) {
    try {
      const absences = await getAbsences(
        { status: req.query.status, kind: req.query.kind },
        req.headers?.authorization
      );
      return res.status(200).json(absences);
    } catch (error) {
      return next(error);
    }
  }

  async function getById(req, res, next) {
    try {
      const absence = await getAbsenceById(req.params.id);
      return res.status(200).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  async function downloadAttachment(req, res, next) {
    try {
      const attachment = await getAbsenceAttachment(req.params.id);
      res.set({
        'Content-Type': attachment.mime_type,
        'Content-Disposition': attachmentDisposition(attachment.file_name, 'comprobante'),
        'X-Content-Type-Options': 'nosniff',
        // Documentos médicos: que no queden en cachés del navegador o proxies.
        'Cache-Control': 'private, no-store',
      });
      return res.status(200).send(attachment.data);
    } catch (error) {
      return next(error);
    }
  }

  async function cover(req, res, next) {
    try {
      const absence = await coverAbsence(req.params.id, req.body);
      return res.status(200).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  async function updateSuggestions(req, res, next) {
    try {
      const absence = await updateSuggestionsState(req.params.id, req.body);
      return res.status(200).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  return {
    create,
    list,
    getById,
    downloadAttachment,
    cover,
    updateSuggestions,
    mine: respond(200, (req) => getMyAbsences(req.user, { from: req.query.from, to: req.query.to })),
    approve: respond(200, (req) => workflow.approveReplacement(req.user, req.params.id, req.body)),
    acknowledged: respond(200, (req) => workflow.acknowledgeAbsence(req.body)),
    missed: respond(200, (req) => workflow.markMissed(req.params.id)),
    expired: respond(200, () => workflow.getExpired()),
    tracking: respond(200, (req) => workflow.getTracking({ date: req.query.date, base: req.query.base })),
    stats: respond(200, (req) => workflow.getStats({ base: req.query.base })),
  };
}

module.exports = createAbsenceController;
