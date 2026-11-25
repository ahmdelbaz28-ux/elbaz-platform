/**
 * QUIZ SCORING — audit run-1 regression tests (fp
 * `api/quiz-router.ts:quiz.submit:duplicate-answer-score-inflation`).
 * Each test pins the exact invariant the fix enforces: the score is the sum
 * over DISTINCT answered questions, duplicates are never scored twice, and
 * the percentage can never exceed 100.
 */
import { describe, it, expect } from "vitest";
import { scoreQuizSubmission } from "./quiz-scoring.js";

const Q = (id: number, points: number, correctIndex: number) => ({ id, points, correctIndex });

describe("audit run-1 fixes: quiz scoring invariant", () => {
  const questions = [Q(1, 10, 2), Q(2, 10, 0), Q(3, 10, 1), Q(4, 10, 3), Q(5, 10, 2)];

  it("scores an honest submission normally", () => {
    const r = scoreQuizSubmission(questions, [
      { questionId: 1, selectedOption: 2 },
      { questionId: 2, selectedOption: 0 },
      { questionId: 3, selectedOption: 1 },
      { questionId: 4, selectedOption: 3 },
      { questionId: 5, selectedOption: 2 },
    ]);
    expect(r.score).toBe(50);
    expect(r.percentage).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.results.every((x) => x.isCorrect)).toBe(true);
    expect(r.results.every((x) => x.correctAnswer !== undefined)).toBe(true);
  });

  it("does NOT score duplicates — N copies of one correct answer ≠ pass", () => {
    // The exact exploit from the audit: duplicate the one known-correct pair
    // across the whole submission; the old per-element scoring summed to 100.
    const r = scoreQuizSubmission(questions, Array.from({ length: 5 }, () => ({ questionId: 1, selectedOption: 2 })));
    expect(r.score).toBe(10); // counted once, not 50
    expect(r.percentage).toBe(20); // 10 / 50
    expect(r.passed).toBe(false);
    expect(r.results).toHaveLength(1);
  });

  it("ignores duplicate entries after the first occurrence (wrong then right)", () => {
    const r = scoreQuizSubmission(questions, [
      { questionId: 1, selectedOption: 0 }, // wrong — counts
      { questionId: 1, selectedOption: 2 }, // duplicate — ignored (first wins)
      { questionId: 2, selectedOption: 0 }, // different question — counts
    ]);
    expect(r.results).toHaveLength(2);
    expect(r.score).toBe(10); // q2 only; the duplicate of q1 never re-scored
    expect(r.results[0].correctAnswer).toBeUndefined(); // wrong → no answer leak
    expect(r.results[1]).toMatchObject({ questionId: 2, isCorrect: true });
  });

  it("never exceeds 100% even with inflated points math", () => {
    const tiny = [Q(9, 1, 1)];
    const r = scoreQuizSubmission(tiny, [{ questionId: 9, selectedOption: 1 }]);
    expect(r.percentage).toBeLessThanOrEqual(100);
    expect(r.percentage).toBe(100);
  });

  it("keeps the anti answer-key contract — wrong answers reveal nothing", () => {
    const r = scoreQuizSubmission(questions, [{ questionId: 1, selectedOption: 0 }]);
    expect(r.results[0].isCorrect).toBe(false);
    expect(r.results[0].correctAnswer).toBeUndefined();
    expect(r.results[0].explanation).toBeUndefined();
  });

  it("treats zero-point and zero-total quizzes safely", () => {
    const zero = [Q(7, 0, 1)];
    const r = scoreQuizSubmission(zero, [{ questionId: 7, selectedOption: 1 }]);
    expect(r.totalPoints).toBe(0);
    expect(r.percentage).toBe(0);
    expect(r.passed).toBe(false);
  });
});
