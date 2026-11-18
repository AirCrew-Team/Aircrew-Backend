function createEventController({ publishAbsenceReported, publishAbsenceCovered }) {
  function absenceReported(req, res, next) {
    try {
      return res.status(202).json(publishAbsenceReported(req.body));
    } catch (error) {
      return next(error);
    }
  }

  function absenceCovered(req, res, next) {
    try {
      return res.status(202).json(publishAbsenceCovered(req.body));
    } catch (error) {
      return next(error);
    }
  }

  return { absenceReported, absenceCovered };
}

module.exports = createEventController;
