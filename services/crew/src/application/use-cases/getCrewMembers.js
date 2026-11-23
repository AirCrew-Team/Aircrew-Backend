function createGetCrewMembers(findCrewMembers, attachUserNames) {
  return async function getCrewMembers() {
    return attachUserNames(await findCrewMembers(), { user_id: 'name' });
  };
}

module.exports = createGetCrewMembers;
