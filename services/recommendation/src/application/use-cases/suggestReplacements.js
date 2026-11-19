const { evaluateReplacements, MAX_FOR_AI } = require('../../domain/services/replacementRanking');
const {
  REPLACEMENT_SYSTEM_PROMPT,
  REPLACEMENT_SCHEMA,
  buildReplacementRequest,
  validateReplacementOutput,
  MAX_RESULTS,
} = require('../../domain/services/aiReplacementPolicy');
const { DomainError } = require('../../domain/errors');

// Busca reemplazos para una ausencia:
// 1. REGLAS    → separa elegibles de no elegibles (las 8 reglas, en código).
// 2. PUNTAJE   → ordena a los elegibles y toma los 15 mejores (plan B).
// 3. CLAUDE    → elige y ordena de 3 a 5, y explica en español.
// 4. VALIDAR   → descarta crew_id que no estaban en la lista o repetidos.
// 5. GUARDAR   → la ronda de candidatos y la auditoría de la llamada.
// 6. AVISAR    → Crew (estado y línea de tiempo) y supervisores por socket,
//                siempre con token de servicio (son endpoints internos).
// Si Claude está apagado, falla, tarda o responde algo inválido, se usa el
// plan B: el supervisor nunca se queda sin candidatos.
function createSuggestReplacements({
  loadReplacementContext,
  ai,
  suggestionRepository,
  aiCallRepository,
  crewClient,
  notificationClient,
  serviceAuthorization,
}) {
  return async function suggestReplacements(absenceId, authorization) {
    const context = await loadReplacementContext(absenceId, authorization);
    const { absence, flight, members, assignments, role } = context;

    if (!role) {
      throw new DomainError(
        'No se pudo saber qué puesto ocupaba el tripulante ausente.',
        409,
        { code: 'unknown_slot' }
      );
    }

    // Quien ya dejó vencer su plazo en esta ausencia no se vuelve a proponer.
    const missed = await suggestionRepository.findMissedUserIds(absence.id);

    const { eligible } = evaluateReplacements({
      members: members.filter((member) => !missed.includes(member.user_id)),
      flight,
      role,
      absentUserId: absence.crew_user_id,
      assignments,
    });

    const shortlist = eligible.slice(0, MAX_FOR_AI);
    const request = buildReplacementRequest({ absence, flight, candidates: shortlist });
    let ranked = null;
    let audit = { usedFallback: true, error: null };

    if (shortlist.length > 0 && ai.isEnabled()) {
      try {
        const result = await ai.decide({
          system: REPLACEMENT_SYSTEM_PROMPT,
          data: request,
          schema: REPLACEMENT_SCHEMA,
          effort: 'medium',
        });
        ranked = validateReplacementOutput(result.output, shortlist);
        audit = {
          usedFallback: !ranked,
          error: ranked ? null : 'La respuesta de la IA no tenía candidatos válidos.',
          model: result.model,
          response: result.output,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs: result.durationMs,
        };
      } catch (error) {
        audit = { usedFallback: true, error: error.message, model: ai.model };
      }
    } else if (shortlist.length > 0) {
      audit.error = 'IA desactivada: se usó el orden por reglas.';
    }

    const suggestions = (ranked
      ? ranked.map((item) => ({ ...item, source: 'ai' }))
      : shortlist.slice(0, MAX_RESULTS).map((candidate) => ({
          candidate,
          affinity: candidate.score,
          checks: candidate.checks,
          rationale: candidate.rationale,
          source: 'rule',
        }))
    ).map((item, index) => ({
      crewUserId: item.candidate.member.user_id,
      rankPosition: index + 1,
      affinity: item.affinity,
      checks: item.checks,
      rationale: item.rationale,
      source: item.source,
    }));

    const saved = await suggestionRepository.saveRound(absence.id, suggestions);

    await aiCallRepository.saveAiCall({
      kind: 'replacement',
      subjectId: absence.id,
      request,
      ...audit,
    });

    const state = suggestions.length > 0 ? 'ready' : 'none';
    await crewClient.updateSuggestionsState(
      absence.id,
      { state, candidateCount: suggestions.length },
      serviceAuthorization()
    );
    await notificationClient.notifySuggestionsReady(
      {
        absence_id: absence.id,
        flight_number: absence.flight_number,
        candidate_count: suggestions.length,
        source: suggestions[0] ? suggestions[0].source : null,
      },
      serviceAuthorization()
    );

    return { state, round: saved.round, candidateCount: suggestions.length };
  };
}

module.exports = createSuggestReplacements;
