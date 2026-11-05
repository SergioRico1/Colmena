// Several questions from a bot, answered one at a time (after shadcn's Questionnaire and
// assistant-ui question-flow): ask_user's first question plus up to four in `more`, each with
// options, a free answer, or both; an optional one can be skipped.

export const MORE_MAX = 4;

/** The questions of one ask_user call: [{ id, question, options: [{id,label,primary}], optional }]. */
export function buildQuestions(args) {
  const first = { question: args.question, options: args.options || [], optional: false };
  return [first, ...(args.more || []).slice(0, MORE_MAX)].map((q, i) => ({
    id: "q" + (i + 1),
    question: String(q.question || "").trim().slice(0, 600),
    options: (q.options || []).map((label, j) => ({ id: "o" + (j + 1), label: String(label).trim().slice(0, 120), primary: j === 0 })),
    optional: i > 0 && q.optional === true,
  }));
}

/**
 * Checks and normalizes the answers ([{ id, optionId?, text?, skipped? }]) to every question:
 * [{ id, question, optionId, label, text, skipped }]. Throws on a missing required answer.
 */
export function checkAnswers(questions = [], answers = []) {
  const byId = new Map((answers || []).map((a) => [a.id, a]));
  return questions.map((q, i) => {
    const a = byId.get(q.id) || {};
    const text = String(a.text || "").trim().slice(0, 4000);
    const option = a.optionId ? q.options.find((o) => o.id === a.optionId) : null;
    if (a.optionId && !option) throw Error(`Pregunta ${i + 1}: esa opción no existe.`);
    if (!option && !text) {
      if (q.optional && a.skipped) return { id: q.id, question: q.question, optionId: null, label: null, text: null, skipped: true };
      throw Error(q.optional ? `Pregunta ${i + 1}: responde o pulsa «Saltar».` : `Pregunta ${i + 1}: falta tu respuesta.`);
    }
    return { id: q.id, question: q.question, optionId: option?.id || null, label: option?.label || null, text: text || null, skipped: false };
  });
}

/** Your answers as one message in the chat. */
export function answersText(normalized = []) {
  return normalized.map((a, i) => `${i + 1}. ${a.question}\n→ ${a.skipped ? "(sin responder)" : a.text || a.label}`).join("\n\n");
}

/** What ask_user returns to the bot once you answered. */
export const answersForBot = (normalized = []) => ({ answers: normalized.map((a) => ({ question: a.question, answer: a.skipped ? null : a.text || a.label })) });

// ------------------------------------------------------------- timed questions
/** Minutes a bot that acts on its own waits for an answer (settings.questionWaitMinutes). */
export const QUESTION_WAIT_MINUTES = 10;

/** ask_user when nobody answered in time: pending, never a refusal nor a permission. */
export const QUESTION_PENDING = Object.freeze({
  pending: true,
  answer: null,
  message: "Nadie ha respondido todavía a tu pregunta. Sigue abierta: si la persona responde más tarde, te llegará como un mensaje suyo marcado como respuesta. " +
    "Esto no es un «no» ni un «sí»: sigue con la opción más prudente, di claramente qué has supuesto y por qué, y no hagas nada que sea línea roja " +
    "(enviar, comprar, publicar, pagar, borrar…) basándote en este silencio: eso déjalo pendiente para la persona.",
});

/** The person's late answer, as the bot reads it (its question already timed out). */
export const lateAnswerText = (question, said) =>
  "La persona responde ahora a tu pregunta «" + String(question || "").slice(0, 300) + "» (llegó después de que siguieras con la opción prudente): «" +
  String(said || "").slice(0, 4000) + "». Revisa lo que supusiste y corrige o completa lo que haga falta según su respuesta.";
