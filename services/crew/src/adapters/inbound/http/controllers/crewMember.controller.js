function createCrewMemberController({ getCrewMembers, getMyCrewProfile }) {
  async function list(req, res, next) {
    try {
      const crewMembers = await getCrewMembers();
      return res.status(200).json(crewMembers);
    } catch (error) {
      return next(error);
    }
  }

  async function me(req, res, next) {
    try {
      const profile = await getMyCrewProfile(req.user);
      return res.status(200).json(profile);
    } catch (error) {
      return next(error);
    }
  }

  return { list, me };
}

module.exports = createCrewMemberController;
