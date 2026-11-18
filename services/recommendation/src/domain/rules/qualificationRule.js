// Habilitación: el cargo del tripulante debe servir para el rol a bordo.
// Reemplaza a las certificaciones mientras no existan esos datos.
const REQUIRED_POSITION = {
  captain: 'pilot',
  first_officer: 'pilot',
  purser: 'cabin_crew',
  flight_attendant: 'cabin_crew',
};

function requiredPositionFor(role) {
  return REQUIRED_POSITION[role] || null;
}

const qualificationRule = {
  name: 'qualification',

  check({ member, role }) {
    const required = requiredPositionFor(role);
    const position = String(member.position || '').trim().toLowerCase();

    if (position !== required) {
      return `Su cargo (${member.position}) no sirve para ${role}; se requiere ${required}.`;
    }

    return null;
  },
};

module.exports = { qualificationRule, requiredPositionFor };
