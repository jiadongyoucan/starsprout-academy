export type QuizAnswer = number | null | undefined;

/** Server-authoritative scoring: only the lesson's own quiz answer keys count. */
export function scoreLesson(blocks: unknown, answers: QuizAnswer[] | undefined): { score: number; correct: number; total: number } {
  const list = Array.isArray(blocks) ? blocks : [];
  const questions = list
    .filter((block: any) => block?.type === 'quiz' && Array.isArray(block.questions))
    .flatMap((block: any) => block.questions as { answer: number }[]);
  if (!questions.length) return { score: 80, correct: 0, total: 0 };
  // Missing answers (old clients / no interaction) are scored at a neutral 80,
  // never at a client-supplied value. A completed quiz is scored from answer keys.
  if (!Array.isArray(answers) || answers.length === 0) return { score: 80, correct: 0, total: questions.length };
  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    const value = answers[i];
    const options = Array.isArray((questions[i] as any).options) ? (questions[i] as any).options.length : 8;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= options) continue;
    if (value === Number(questions[i].answer)) correct += 1;
  }
  return { score: Math.round((correct / questions.length) * 100), correct, total: questions.length };
}
