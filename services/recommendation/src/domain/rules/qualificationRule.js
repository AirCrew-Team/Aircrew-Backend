// Rango: el cargo del tripulante debe ser el del puesto. El piloto de relevo
// (relief) puede ser capitán o primer oficial.
const ACCEPTED_RANKS = {
  captain: ['captain'],
  first_officer: ['first_officer'],
  relief: ['captain', 'first_officer'],
  purser: ['purser'],
  flight_attendant: ['flight_attendant'],
};

function acceptedRanksFor(role) {
  return ACCEPTED_RANKS[role] || [];
}

// Se mantiene para la respuesta de candidatos: el cargo que pide el puesto.
function requiredPositionFor(role) {
  return acceptedRanksFor(role).join(' o ') || null;
}

const qualificationRule = {
  name: 'qualification',

  check({ member, role }) {
    const accepted = acceptedRanksFor(role);

    if (!accepted.includes(member.rank)) {
      return `Su cargo (${member.rank || 'sin cargo'}) no sirve para ${role}; se requiere ${accepted.join(' o ')}.`;
    }

    return null;
  },
};

module.exports = { qualificationRule, requiredPositionFor, acceptedRanksFor };
