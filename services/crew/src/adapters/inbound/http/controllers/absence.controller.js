function createAbsenceController({ reportAbsence, getAbsences }) {
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
      const absences = await getAbsences();
      return res.status(200).json(absences);
    } catch (error) {
      return next(error);
    }
  }

  return { create, list };
}

module.exports = createAbsenceController;
