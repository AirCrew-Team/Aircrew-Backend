const { availabilityRule } = require('../rules/availabilityRule');
const { qualificationRule } = require('../rules/qualificationRule');
const { restRule } = require('../rules/restRule');
const { scoreCandidate } = require('./scoring');

const RULES = [availabilityRule, qualificationRule, restRule];

// 1. Descarta a quien no cumple alguna regla.
// 2. Ordena a los demás por puntaje (y por código de empleado si empatan).
function rankCandidates({ members, flight, role, absentUserId, assignments }) {
  const candidates = [];
  const discarded = [];

  for (const member of members) {
    if (member.user_id === absentUserId) {
      continue;
    }

    const memberAssignments = assignments.filter(
      (item) => item.crew_user_id === member.user_id
    );
    const context = { member, flight, role, memberAssignments };
    const summary = {
      user_id: member.user_id,
      employee_code: member.employee_code,
      position: member.position,
      current_location: member.current_location,
    };

    const failures = RULES.map((rule) => rule.check(context)).filter(Boolean);

    if (failures.length > 0) {
      discarded.push({ ...summary, reasons: failures });
      continue;
    }

    candidates.push({ ...summary, ...scoreCandidate(context) });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.employee_code).localeCompare(String(b.employee_code))
  );

  return { candidates, discarded };
}

module.exports = { rankCandidates };
