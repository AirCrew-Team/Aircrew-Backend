function createCrewMemberController(createCrewMember) {
  async function create(req, res, next) {
    try {
      const crewMember = await createCrewMember(req.body);
      return res.status(201).json(crewMember);
    } catch (error) {
      return next(error);
    }
  }

  return { create };
}

module.exports = createCrewMemberController;