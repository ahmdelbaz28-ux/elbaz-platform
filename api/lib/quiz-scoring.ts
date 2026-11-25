/**
 * QUIZ SCORING — pure, unit-testable submission scoring (audit run-1 fix).
 *
 * Security invariant enforced here (audit run-1, fp
 * `api/quiz-router.ts:quiz.submit:duplicate-answer-score-inflation`):
 * the score MUST be the sum over DISTINCT answered questions. The wire
 * format previously allowed `[{questionId: q, ...} × N]` duplicates and the
 * route scored every element — N duplicates of one correct answer summed to
 * totalPoints → persisted 100% pass on any quiz (incl. paid courses),
 * feeding enrollment completion and the public certificate boundary.
 *
 * Defense in depth (two independent layers):
 *   1. The route's zod input REJECTS duplicate questionIds outright
 *      (BAD_REQUEST) — see quiz-router.ts.
 *   2. This helper ALSO deduplicates before scoring, so even a future
 *      caller that skips layer 1 can never inflate a score again.
 */

export interface QuizQuestionLike {
  id: number;
  points: number;
  /** Schema allows NULL correctIndex (question without a keyed option) — never matches a selected option. */
  correctIndex: number | null;
}

export interface QuizAnswerLike {
  questionId: number;
  selectedOption: number;
}

export interface QuizSubmissionResultItem {
  questionId: number;
  isCorrect: boolean;
  /** Only revealed when the student got it right (anti answer-key extraction). */
  correctAnswer: number | undefined;
  explanation: undefined;
}

export interface QuizScoreSummary {
  score: number;
  totalPoints: number;
  /** Clamped to [0, 100] — duplicates can no longer push it past 100. */
  percentage: number;
  passed: boolean;
  results: QuizSubmissionResultItem[];
}

/** Hard cap for the returned percentage (matches the mathematical maximum). */
const MAX_PERCENTAGE = 100;

/**
 * Score a submission against the lesson's questions.
 * - First occurrence of each questionId wins (later duplicates are ignored
 *   for scoring AND for the results list — identical to the pre-fix visible
 *   shape for honest submissions).
 * - Percentage is computed over the DISTINCT answered set but clamped to 100.
 */
export function scoreQuizSubmission(
  questions: QuizQuestionLike[],
  answers: QuizAnswerLike[],
): QuizScoreSummary {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  const seen = new Set<number>();
  let score = 0;
  const results: QuizSubmissionResultItem[] = [];

  for (const ans of answers) {
    if (seen.has(ans.questionId)) continue; // duplicate — never scored twice
    seen.add(ans.questionId);
    const question = byId.get(ans.questionId);
    const isCorrect = question !== undefined && question.correctIndex === ans.selectedOption;
    if (isCorrect) score += question?.points || 0;
    results.push({
      questionId: ans.questionId,
      isCorrect,
      // isCorrect implies a non-null matching correctIndex (=== against the
      // selected number) — null correctIndex can never be "correct".
      correctAnswer: isCorrect && question ? (question.correctIndex as number) : undefined,
      explanation: undefined,
    });
  }

  const rawPercentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  const percentage = Math.min(rawPercentage, MAX_PERCENTAGE);
  return { score, totalPoints, percentage, passed: percentage >= 70, results };
}
