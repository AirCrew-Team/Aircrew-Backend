function createCrewMemberController({ createCrewMember, getCrewMembers }) {
  async function create(req, res, next) {
    try {
      const crewMember = await createCrewMember(req.body);
      return res.status(201).json(crewMember);
    } catch (error) {
      return next(error);
    }
  }

  async function list(req, res, next) {
    try {
      const crewMembers = await getCrewMembers();
      return res.status(200).json(crewMembers);
    } catch (error) {
      return next(error);
    }
  }

  return { create, list };
}

module.exports = createCrewMemberController;
