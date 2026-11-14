function createAircraftController({
  createAircraft,
  getOperatingAircraft,
  getAircraftStatusSummary,
}) {
  async function create(req, res, next) {
    try {
      const aircraft = await createAircraft(req.body);
      return res.status(201).json(aircraft);
    } catch (error) {
      return next(error);
    }
  }

  async function listOperating(req, res, next) {
    try {
      const aircraft = await getOperatingAircraft();
      return res.status(200).json(aircraft);
    } catch (error) {
      return next(error);
    }
  }

  async function getSummary(req, res, next) {
    try {
      const summary = await getAircraftStatusSummary();
      return res.status(200).json(summary);
    } catch (error) {
      return next(error);
    }
  }

  return { create, listOperating, getSummary };
}

module.exports = createAircraftController;
