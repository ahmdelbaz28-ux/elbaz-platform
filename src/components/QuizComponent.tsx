import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { trackLearning, trackEvent } from "@/lib/clarity";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react";

interface QuizComponentProps {
  lessonId: number;
  // ✅ SECURITY FIX: userId removed — server extracts it from JWT
}

export default function QuizComponent({ lessonId }: QuizComponentProps) {
  const { t, lang } = useTranslation();
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<{ questionId: number; selectedOption: number }[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [quizStartedTracked, setQuizStartedTracked] = useState(false);

  const { data: questions, isLoading } = trpc.quiz.byLesson.useQuery({ lessonId });
  const submitMutation = trpc.quiz.submit.useMutation();

  // Track quiz start (first time user interacts with quiz)
  useEffect(() => {
    if (questions && questions.length > 0 && answers.length > 0 && !quizStartedTracked && !showResult) {
      trackLearning("quiz_started", { lessonId, questionCount: questions.length });
      setQuizStartedTracked(true);
    }
  }, [answers.length, questions, lessonId, quizStartedTracked, showResult]);

  // Track quiz result (passed/failed) when result arrives
  useEffect(() => {
    if (showResult && submitMutation.data) {
      const result = submitMutation.data;
      trackLearning(result.passed ? "quiz_passed" : "quiz_failed", {
        lessonId,
        score: result.percentage,
        totalPoints: result.totalPoints,
      });
    }
  }, [showResult, submitMutation.data, lessonId]);

  if (isLoading) {
    return <div className="py-4 text-sm text-[#94a3b8]">{t("loading")}</div>;
  }

  if (!questions || questions.length === 0) {
    return <p className="text-sm text-[#94a3b8]">{lang === "en" ? "No quiz questions for this lesson yet." : "لا توجد أسئلة اختبار لهذا الدرس بعد."}</p>;
  }

  const question = questions[currentQ];
  const qText = lang === "ar" && question.questionAr ? question.questionAr : question.questionEn;
  const options = lang === "ar" && question.optionsAr ? question.optionsAr : question.optionsEn;

  const handleSelect = (optionIndex: number) => {
    const existing = answers.find((a) => a.questionId === question.id);
    if (existing) {
      setAnswers(answers.map((a) =>
        a.questionId === question.id ? { ...a, selectedOption: optionIndex } : a
      ));
    } else {
      setAnswers([...answers, { questionId: question.id, selectedOption: optionIndex }]);
    }
  };

  const handleFinish = async () => {
    if (answers.length === 0) return;
    // ✅ Track quiz submission in Clarity
    trackLearning("quiz_submitted", { lessonId, answersCount: answers.length });
    // ✅ SECURITY FIX: userId not sent — server gets it from JWT context
    submitMutation.mutate({
      lessonId,
      answers,
    });
    setShowResult(true);
  };

  const isSelected = (optionIndex: number) => {
    return answers.find((a) => a.questionId === question.id)?.selectedOption === optionIndex;
  };

  if (showResult && submitMutation.data) {
    const result = submitMutation.data;
    return (
      <div className="rounded-lg border border-[#1f2d44] bg-[#0a0e17] p-6">
        <div className="text-center">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            result.passed ? "bg-[rgba(16,185,129,0.15)]" : "bg-[rgba(244,63,94,0.15)]"
          }`}>
            {result.passed ? (
              <CheckCircle className="h-8 w-8 text-[#10b981]" />
            ) : (
              <XCircle className="h-8 w-8 text-[#f43f5e]" />
            )}
          </div>
          <h4 className="mt-4 text-xl font-bold text-[#f0f4f8]">
            {t("yourScore")}: {result.percentage}%
          </h4>
          <p className={`mt-1 text-sm font-medium ${result.passed ? "text-[#10b981]" : "text-[#f43f5e]"}`}>
            {result.passed ? t("passed") : t("failed")}
          </p>
          <p className="mt-2 text-sm text-[#94a3b8]">
            {result.score} / {result.totalPoints} {lang === "en" ? "points" : "نقطة"}
          </p>
        </div>

        {/* Detailed results */}
        <div className="mt-6 space-y-4">
          {result.results.map((r: any, i: number) => {
            const q = questions.find((q) => q.id === r.questionId);
            return (
              <div key={i} className="rounded-lg border border-[#1f2d44] p-4">
                <div className="flex items-start gap-2">
                  {r.isCorrect ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#10b981]" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#f43f5e]" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-[#f0f4f8]">
                      {lang === "ar" ? q?.questionAr : q?.questionEn}
                    </p>
                    <p className="mt-1 text-xs text-[#94a3b8]">
                      {t("explanation")}: {lang === "ar" ? q?.explanationAr : q?.explanationEn}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Button
          variant="outline"
          className="mt-6 w-full border-[#1f2d44] text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"
          onClick={() => {
            setShowResult(false);
            setAnswers([]);
            setCurrentQ(0);
            submitMutation.reset();
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {t("retakeQuiz")}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-[#64748b]">
          {t("question")} {currentQ + 1} {t("of")} {questions.length}
        </span>
        <div className="h-2 w-24 rounded-full bg-[#1f2d44]">
          <div
            className="h-full rounded-full bg-[#06b6d4] transition-all"
            style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <p className="mb-4 text-base font-medium text-[#f0f4f8]">{qText}</p>

      <div className="space-y-2">
        {options?.map((opt: string, i: number) => (
          <button
            key={i}
            onClick={() => handleSelect(i)}
            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors ${
              isSelected(i)
                ? "border-[#06b6d4] bg-[rgba(6,182,212,0.1)] text-[#f0f4f8]"
                : "border-[#1f2d44] text-[#94a3b8] hover:border-[#64748b]"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                isSelected(i)
                  ? "bg-[#06b6d4] text-[#0a0e17]"
                  : "bg-[#1a2233] text-[#64748b]"
              }`}
            >
              {String.fromCharCode(65 + i)}
            </span>
            {opt}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={currentQ === 0}
          onClick={() => setCurrentQ(currentQ - 1)}
          className="text-[#94a3b8] hover:text-[#f0f4f8]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("previous")}
        </Button>

        {currentQ < questions.length - 1 ? (
          <Button
            size="sm"
            onClick={() => setCurrentQ(currentQ + 1)}
            className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#0891b2]"
          >
            {t("next")}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleFinish}
            disabled={answers.length === 0 || submitMutation.isPending}
            className="bg-[#10b981] text-white hover:bg-[#059669]"
          >
            {t("finish")}
          </Button>
        )}
      </div>
    </div>
  );
}
