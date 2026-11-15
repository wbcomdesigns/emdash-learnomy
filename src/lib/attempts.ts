import type { Attempt, Question, Quiz } from "../schemas";
import { asRecord, asString } from "../util";

/** Submissions an attempt row keeps; attempts still counts every one. */
export const MAX_HISTORY = 20;

/** Score as a whole percent, rounded down, so 2 of 3 (66.7%) never meets a pass mark of 67. */
export const percentOf = (score: number, total: number) => (total > 0 ? Math.floor((score * 100) / total) : 0);

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * A stored attempt row, or null. A 0.1.x row (no attempts, best or history) reads as one attempt whose
 * latest score is its history and its best, so an upgrade needs no migration step.
 */
export function readAttempt(raw: unknown): Attempt | null {
	const row = asRecord(raw);
	if (!asString(row.memberId) || !asString(row.quizId)) return null;
	const score = num(row.score, 0);
	const total = num(row.total, 0);
	const submittedAt = asString(row.submittedAt);
	const history = Array.isArray(row.history) ? (row.history as Attempt["history"]) : [{ score, total, submittedAt }];
	return {
		memberId: asString(row.memberId),
		quizId: asString(row.quizId),
		lessonKey: asString(row.lessonKey),
		score,
		total,
		answers: Array.isArray(row.answers) ? row.answers : [],
		submittedAt,
		attempts: num(row.attempts, 1),
		best: num(row.best, percentOf(score, total)),
		history,
	};
}

/** True when a graded quiz has a pass mark: only then does it gate completeLesson. Practice never blocks. */
export const gates = (quiz: Quiz) => quiz.mode === "graded" && quiz.passMark !== undefined && quiz.questions.length > 0;

/** The member passed `quiz` with their best score. Without a pass mark there is nothing to pass. */
export const hasPassed = (quiz: Quiz, attempt: Attempt | null) => !gates(quiz) || (attempt !== null && attempt.best >= quiz.passMark!);

/**
 * What the retake policy allows now: attempts left (null when unlimited) and the time the member may
 * try again (null when they may now). Computed on the server only.
 */
export function retakeState(quiz: Quiz, attempt: Attempt | null, now = Date.now()): { attemptsLeft: number | null; retryAt: string | null } {
	const used = attempt?.attempts ?? 0;
	const policy = quiz.retake;
	if (policy.type === "max") return { attemptsLeft: Math.max(0, policy.attempts - used), retryAt: null };
	if (policy.type === "wait" && attempt?.submittedAt) {
		const at = Date.parse(attempt.submittedAt) + policy.minutes * 60_000;
		return { attemptsLeft: null, retryAt: at > now ? new Date(at).toISOString() : null };
	}
	return { attemptsLeft: null, retryAt: null };
}

/** Typed answers compare without case and extra spacing. */
export const normalText = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Whether one answer to `q` is right, or null when it is not an answer of the right kind. */
export function grade(q: Question, answer: unknown): boolean | null {
	if (q.type === "choice" || q.type === "true_false") {
		const max = q.type === "choice" ? 3 : 1;
		return typeof answer === "number" && Number.isInteger(answer) && answer >= 0 && answer <= max ? answer === q.correct : null;
	}
	if (q.type === "multi") {
		if (!Array.isArray(answer) || answer.length === 0) return null;
		const picked = new Set(answer as number[]);
		const correct = new Set(q.correct);
		return picked.size === correct.size && [...correct].every((i) => picked.has(i));
	}
	if (typeof answer !== "string" || !answer.trim()) return null;
	const given = normalText(answer);
	return q.accepted.some((accepted) => normalText(accepted) === given);
}

/** The right answer and explanation of one question, for the submit response of a Practice quiz only. */
export const reviewOf = (q: Question) => ({
	correct: q.type === "short" || q.type === "blank" ? q.accepted : q.correct,
	...(q.explain ? { explain: q.explain } : {}),
});
