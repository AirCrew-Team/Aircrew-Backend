function createEventController({ publishAbsenceReported, publishAbsenceCovered }) {
  async function absenceReported(req, res, next) {
    try {
      return res.status(202).json(await publishAbsenceReported(req.body));
    } catch (error) {
      return next(error);
    }
  }

  async function absenceCovered(req, res, next) {
    try {
      return res.status(202).json(await publishAbsenceCovered(req.body));
    } catch (error) {
      return next(error);
    }
  }

  return { absenceReported, absenceCovered };
}

module.exports = createEventController;
