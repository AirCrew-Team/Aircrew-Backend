function createAbsenceController({
  reportAbsence,
  getAbsences,
  getAbsenceById,
  coverAbsence,
  updateSuggestionsState,
}) {
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
      const absences = await getAbsences({ status: req.query.status });
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

  return { create, list, getById, cover, updateSuggestions };
}

module.exports = createAbsenceController;
