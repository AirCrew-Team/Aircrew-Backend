function createGetCrewMembers(findCrewMembers) {
  return function getCrewMembers() {
    return findCrewMembers();
  };
}

module.exports = createGetCrewMembers;
