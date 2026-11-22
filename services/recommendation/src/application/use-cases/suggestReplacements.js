const { evaluateReplacements, MAX_FOR_AI } = require('../../domain/services/replacementRanking');
const {
  REPLACEMENT_SYSTEM_PROMPT,
  REPLACEMENT_SCHEMA,
  buildReplacementRequest,
  validateReplacementOutput,
} = require('../../domain/services/aiReplacementPolicy');
const { DomainError } = require('../../domain/errors');

// Busca reemplazos para una ausencia:
// 1. REGLAS    → separa elegibles de no elegibles (las 8 reglas, en código).
// 2. FILTRO    → ordena a los elegibles por puntaje y envía los 15 mejores.
// 3. CLAUDE    → elige y ordena de 3 a 5, y explica en español.
// 4. VALIDAR   → descarta crew_id que no estaban en la lista o repetidos.
// 5. GUARDAR   → la ronda de candidatos y la auditoría de la llamada.
// 6. AVISAR    → Crew (estado y línea de tiempo) y supervisores por SSE,
//                siempre con token de servicio (son endpoints internos).
// Si Claude no responde o responde algo inválido, la ausencia queda con
// suggestions_state = "error" y el supervisor puede pedir otra ronda.
function createSuggestReplacements({
  loadReplacementContext,
  ai,
  suggestionRepository,
  aiCallRepository,
  crewClient,
  notificationClient,
  serviceAuthorization,
}) {
  // Informa el resultado a Crew (estado y línea de tiempo) y a los supervisores
  // por SSE. Son endpoints internos: siempre con token de servicio.
  async function report(absence, state, count) {
    await crewClient.updateSuggestionsState(
      absence.id,
      { state, candidateCount: count },
      serviceAuthorization()
    );
    await notificationClient.notifySuggestionsReady(
      {
        absence_id: absence.id,
        flight_number: absence.flight_number,
        candidate_count: count,
        source: state === 'ready' ? 'ai' : null,
        state,
      },
      serviceAuthorization()
    );
  }

  // reason: motivo opcional del supervisor. Solo influye en el orden y la
  // explicación de Claude; las reglas ya se aplicaron antes.
  return async function suggestReplacements(absenceId, authorization, { reason = null } = {}) {
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
    const request = buildReplacementRequest({
      absence,
      flight,
      candidates: shortlist,
      supervisorNote: reason,
    });

    // Nadie cumple las reglas: no hay nada que preguntarle a la IA.
    if (shortlist.length === 0) {
      await suggestionRepository.saveRound(absence.id, [], reason);
      await report(absence, 'none', 0);
      return { state: 'none', round: null, candidateCount: 0 };
    }

    // Solo Claude ordena y explica. Si no responde o responde algo inválido,
    // se informa el error: no hay un orden de respaldo.
    let ranked = null;
    let audit;
    try {
      if (!ai.isEnabled()) throw new Error('La IA está desactivada (AI_ENABLED=false).');
      const result = await ai.decide({
        system: REPLACEMENT_SYSTEM_PROMPT,
        data: request,
        schema: REPLACEMENT_SCHEMA,
        effort: 'medium',
      });
      ranked = validateReplacementOutput(result.output, shortlist);
      audit = {
        usedFallback: false,
        error: ranked ? null : 'La respuesta de la IA no tenía candidatos válidos.',
        model: result.model,
        response: result.output,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
      };
    } catch (error) {
      audit = { usedFallback: false, error: error.message, model: ai.model };
    }

    await aiCallRepository.saveAiCall({ kind: 'replacement', subjectId: absence.id, request, ...audit });

    if (!ranked) {
      await report(absence, 'error', 0);
      throw new DomainError(
        'La IA no pudo proponer candidatos. Intenta de nuevo en unos minutos.',
        503,
        { code: 'ai_unavailable' }
      );
    }

    const suggestions = ranked.map((item, index) => ({
      crewUserId: item.candidate.member.user_id,
      rankPosition: index + 1,
      affinity: item.affinity,
      checks: item.checks,
      rationale: item.rationale,
      source: 'ai',
    }));

    const saved = await suggestionRepository.saveRound(absence.id, suggestions, reason);
    await report(absence, 'ready', suggestions.length);

    const state = 'ready';
    return { state, round: saved.round, candidateCount: suggestions.length };
  };
}

module.exports = createSuggestReplacements;
