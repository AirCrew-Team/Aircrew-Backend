function createFlightController({ createFlight, getFlights, getFlightById, crewSlots, manageFlights }) {
  const respond = (status, run) => async (req, res, next) => {
    try {
      return res.status(status).json(await run(req));
    } catch (error) {
      return next(error);
    }
  };

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
        ids: req.query.ids,
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

  return {
    create,
    list,
    getById,
    crewPlan: respond(200, (req) => crewSlots.getCrewPlan(req.params.id)),
    assignSlot: respond(201, (req) => crewSlots.assignSlot(req.params.id, req.params.slotId, req.body)),
    removeSlot: respond(200, (req) => crewSlots.removeSlot(req.params.id, req.params.slotId)),
    options: respond(200, () => manageFlights.getOptions()),
    manage: respond(200, (req) => manageFlights.listFlights(req.query)),
    stats: respond(200, () => manageFlights.getStats()),
    confirmCrew: respond(200, (req) => crewSlots.confirmCrew(req.params.id, req.user)),
  };
}

module.exports = createFlightController;
