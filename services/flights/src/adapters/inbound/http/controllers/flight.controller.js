function createFlightController({ createFlight, getFlights, getFlightById }) {
  async function create(req, res, next) {
    try {
      const flight = await createFlight(req.body);
      return res.status(201).json(flight);
    } catch (error) {
      return next(error);
    }
  }

  async function list(req, res, next) {
    try {
      const flights = await getFlights({
        from: req.query.from,
        to: req.query.to,
      });
      return res.status(200).json(flights);
    } catch (error) {
      return next(error);
    }
  }

  async function getById(req, res, next) {
    try {
      const flight = await getFlightById(req.params.id);
      return res.status(200).json(flight);
    } catch (error) {
      return next(error);
    }
  }

  return { create, list, getById };
}

module.exports = createFlightController;
