import { MAX_ATTEMPTS, MAX_QUESTIONS, MAX_WAIT_MINUTES, quiz as quizSchema, type Question, type Quiz } from "../schemas";
import { type Ctx, type Fail, fail, newId, newRev, nowIso, parse, STALE } from "./common";
import { asRecord, asString } from "../util";

export const PAGE = 25;
const TOO_MANY = fail("TOO_MANY_QUESTIONS", `A quiz holds at most ${MAX_QUESTIONS} questions.`);

export async function getQuiz(ctx: Ctx, id: string): Promise<Quiz | null> {
	return parse(quizSchema, await ctx.storage.quizzes!.get(id));
}

/** Plain words for what is wrong with one question, or null. Limits match the quiz schema. */
export function questionProblem(q: Question): string | null {
	if (!q.prompt.trim()) return "Write the question first.";
	if (q.prompt.trim().length > 500) return "Keep the question under 500 characters.";
	if ((q.type === "choice" || q.type === "multi") && q.answers.some((a) => !a.trim())) return "Fill in all four answers.";
	if ((q.type === "choice" || q.type === "multi") && q.answers.some((a) => a.trim().length > 200)) return "Keep each answer under 200 characters.";
	if (q.type === "multi" && q.correct.length === 0) return "Tick at least one right answer.";
	if ((q.type === "short" || q.type === "blank") && !q.accepted.some((a) => a.trim())) return "Write at least one accepted answer.";
	if ((q.type === "short" || q.type === "blank") && q.accepted.length > 10) return "Keep it to 10 accepted answers.";
	if ((q.type === "short" || q.type === "blank") && q.accepted.some((a) => a.trim().length > 200)) return "Keep each accepted answer under 200 characters.";
	if (q.type === "blank" && !q.prompt.includes(BLANK)) return `Mark the blank in the question with three underscores (${BLANK}).`;
	if ((q.explain ?? "").trim().length > 1000) return "Keep the explanation under 1,000 characters.";
	return null;
}

/** Where a fill-in-the-blank question puts its answer box. */
export const BLANK = "___";

/** Plain words for what is wrong with a quiz's pass mark or retake policy, or null. */
function settingsProblem(quiz: QuizDraft): string | null {
	const whole = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
	if (quiz.passMark !== undefined && !whole(quiz.passMark, 1, 100)) return "The pass mark is a whole percent from 1 to 100, or 0 for none.";
	if (quiz.retake?.type === "max" && !whole(quiz.retake.attempts, 1, MAX_ATTEMPTS)) return `Allow from 1 to ${MAX_ATTEMPTS} attempts.`;
	if (quiz.retake?.type === "wait" && !whole(quiz.retake.minutes, 1, MAX_WAIT_MINUTES)) return `The wait is from 1 to ${MAX_WAIT_MINUTES} minutes (30 days).`;
	return null;
}

/** What a writer hands writeQuiz: a 0.1.x-shaped quiz is fine, mode and retake take their defaults. */
export type QuizDraft = Omit<Quiz, "updatedAt" | "rev" | "mode" | "retake"> & Partial<Pick<Quiz, "mode" | "retake">>;

/** Plain words for what is wrong with a quiz title, or null. */
function titleProblem(title: string): string | null {
	if (!title.trim()) return "Give the quiz a title.";
	if (title.trim().length > 200) return "Keep the quiz title under 200 characters.";
	return null;
}

/** The marker that holds a lesson for one quiz. Its compare-and-set is what makes "one quiz per lesson" hold under two saves at once. */
const lessonMarker = (lesson: string) => `state:lesson-quiz:${lesson}`;

/**
 * Hold `lesson` for `quizId`, or refuse naming the quiz that has it. Two saves at once both try a
 * create-only compare-and-set; one wins. The marker only counts while the quiz it names still sits on
 * the lesson: a marker whose quiz was deleted, or moved to another lesson while freeing this one
 * failed, is taken over. The holder is read raw, so a stored quiz that fails the schema but still
 * carries this lessonKey keeps the lesson (no second quiz on it). Four calls at most.
 */
async function claimLesson(ctx: Ctx, lesson: string, quizId: string): Promise<{ revision: string } | Fail> {
	const key = lessonMarker(lesson);
	const first = await ctx.kv.compareAndSet(key, null, quizId);
	if (first.applied) return { revision: first.revision };
	const current = await ctx.kv.getVersioned<string>(key);
	if (current?.value === quizId) return { revision: current.revision };
	if (!current) {
		const again = await ctx.kv.compareAndSet(key, null, quizId);
		if (again.applied) return { revision: again.revision };
	} else {
		const holder = asRecord(await ctx.storage.quizzes!.get(current.value));
		if (holder.lessonKey === lesson) {
			const title = asString(holder.title) || "that needs fixing";
			return fail("LESSON_HAS_QUIZ", `That lesson already has the quiz "${title}". Each lesson has one quiz: choose another lesson, or move that quiz first.`);
		}
		const take = await ctx.kv.compareAndSet(key, current.revision, quizId);
		if (take.applied) return { revision: take.revision };
	}
	return fail("LESSON_HAS_QUIZ", "Another quiz took that lesson just now. Choose another lesson.");
}

/** Free `lesson` if `quizId` holds it. */
async function releaseLesson(ctx: Ctx, lesson: string, quizId: string): Promise<void> {
	const current = await ctx.kv.getVersioned<string>(lessonMarker(lesson)).catch(() => null);
	if (current?.value === quizId) await ctx.kv.compareAndDelete(lessonMarker(lesson), current.revision).catch(() => undefined);
}

/** The quiz of a lesson, through the lessonKey index. One call. */
export async function quizForLesson(ctx: Ctx, lesson: string): Promise<{ id: string; quiz: Quiz } | null> {
	const page = await ctx.storage.quizzes!.query({ where: { lessonKey: lesson }, limit: 1 });
	const item = page.items[0];
	const quiz = item ? parse(quizSchema, item.data) : null;
	return item && quiz ? { id: item.id, quiz } : null;
}

/**
 * The one writer of quizzes. `change` gets the stored quiz (or null for a new one) and returns the
 * quiz to store or a refusal. A stale version token is refused. Two calls (getVersioned, write); a
 * lesson change adds the lesson check, its marker, and freeing the old one: eight at most.
 */
export async function writeQuiz(
	ctx: Ctx,
	id: string | null,
	rev: string | undefined,
	change: (current: Quiz | null) => QuizDraft | Fail,
): Promise<{ ok: true; id: string; quiz: Quiz } | Fail> {
	const key = id ?? newId();
	const current = id ? await ctx.storage.quizzes!.getVersioned(id) : null;
	if (id && !current) return fail("QUIZ_NOT_FOUND", "That quiz no longer exists.");
	const row = current ? parse(quizSchema, current.value) : null;
	if (id && (row?.rev ?? "") !== (rev ?? "")) return STALE("quiz");
	const changed = change(row);
	if ("ok" in changed) return changed;
	if (changed.questions.length > MAX_QUESTIONS) return TOO_MANY;
	const badTitle = titleProblem(changed.title) ?? settingsProblem(changed);
	if (badTitle) return fail("INVALID_QUIZ", badTitle);
	for (const q of changed.questions) {
		const problem = questionProblem(q);
		if (problem) return fail("INVALID_QUESTION", problem);
	}
	// A practice quiz never blocks, so it keeps no pass mark (SCOPE 0.2.0), whichever writer saved it.
	const next = parse(quizSchema, { ...changed, ...(changed.mode === "practice" ? { passMark: undefined } : {}), updatedAt: nowIso(), rev: newRev() });
	if (!next) return fail("INVALID_QUIZ", "Something in this quiz is not valid. Reload it and try again.");
	const before = row?.lessonKey ?? "";
	let claim: { revision: string } | null = null;
	if (next.lessonKey && next.lessonKey !== before) {
		const lesson = await ctx.content!.get("lms_lessons", next.lessonKey).catch(() => null);
		if (!lesson) return fail("LESSON_NOT_FOUND", "That lesson no longer exists. Choose another one.");
		const held = await claimLesson(ctx, next.lessonKey, key);
		if ("ok" in held) return held;
		claim = held;
	}
	// A refused or failed write gives the claimed lesson back, so no marker outlives its claim.
	const unclaim = async () => {
		if (claim) await ctx.kv.compareAndDelete(lessonMarker(next.lessonKey), claim.revision).catch(() => undefined);
	};
	let applied = false;
	try {
		applied = (await ctx.storage.quizzes!.compareAndSet(key, current?.revision ?? null, next)).applied;
	} catch (error) {
		await unclaim();
		throw error;
	}
	if (!applied) {
		await unclaim();
		return STALE("quiz");
	}
	if (before && before !== next.lessonKey) await releaseLesson(ctx, before, key);
	return { ok: true, id: key, quiz: next };
}

/** Delete with the version token the owner saw, freeing its lesson. Four calls at most. */
export async function deleteQuiz(ctx: Ctx, id: string, rev: string): Promise<{ ok: true; title: string } | Fail> {
	const current = await ctx.storage.quizzes!.getVersioned(id);
	if (!current) return fail("QUIZ_NOT_FOUND", "That quiz is already gone.");
	const row = parse(quizSchema, current.value);
	if ((row?.rev ?? "") !== rev) return STALE("quiz");
	const done = await ctx.storage.quizzes!.compareAndDelete(id, current.revision);
	if (!done.applied) return STALE("quiz");
	if (row?.lessonKey) await releaseLesson(ctx, row.lessonKey, id);
	return { ok: true, title: row?.title ?? "" };
}

/** Newest first, 25 a page. One call. */
export async function listQuizzes(ctx: Ctx, cursor?: string) {
	const page = await ctx.storage.quizzes!.query({ orderBy: { updatedAt: "desc" }, limit: PAGE, ...(cursor ? { cursor } : {}) });
	const items = page.items.map((item) => {
		const row = parse(quizSchema, item.data);
		return { id: item.id, title: row?.title ?? "Quiz that needs fixing", questions: row?.questions.length ?? 0, mode: row?.mode ?? "graded", passMark: row?.passMark ?? null, updatedAt: row?.updatedAt ?? "", rev: row?.rev ?? "" };
	});
	return { items, cursor: page.hasMore ? page.cursor : undefined };
}
