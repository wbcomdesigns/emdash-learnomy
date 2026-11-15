import { MAX_QUESTIONS, quiz as quizSchema, type Question, type Quiz } from "../schemas";
import { type Ctx, type Fail, fail, newId, newRev, nowIso, parse, STALE } from "./common";

export const PAGE = 25;
const TOO_MANY = fail("TOO_MANY_QUESTIONS", `A quiz holds at most ${MAX_QUESTIONS} questions.`);

export async function getQuiz(ctx: Ctx, id: string): Promise<Quiz | null> {
	return parse(quizSchema, await ctx.storage.quizzes!.get(id));
}

/** Plain words for what is wrong with one question, or null. */
export function questionProblem(q: Question): string | null {
	if (!q.prompt.trim()) return "Write the question first.";
	if (q.type === "choice" && q.answers.some((a) => !a.trim())) return "Fill in all four answers.";
	return null;
}

/** The marker that holds a lesson for one quiz. Its compare-and-set is what makes "one quiz per lesson" hold under two saves at once. */
const lessonMarker = (lesson: string) => `state:lesson-quiz:${lesson}`;

/**
 * Hold `lesson` for `quizId`, or refuse naming the quiz that has it. Two saves at once both try a
 * create-only compare-and-set; one wins. A marker whose quiz no longer exists is taken over.
 * ponytail: a marker can outlive its claim only if the quiz write and the release both fail; the
 * quiz it names is then edited (or deleted) to free the lesson.
 */
async function claimLesson(ctx: Ctx, lesson: string, quizId: string): Promise<{ revision: string } | Fail> {
	const key = lessonMarker(lesson);
	const first = await ctx.kv.compareAndSet(key, null, quizId);
	if (first.applied) return { revision: first.revision };
	const current = await ctx.kv.getVersioned<string>(key);
	if (!current || current.value === quizId) {
		const again = current ? { applied: true as const, revision: current.revision } : await ctx.kv.compareAndSet(key, null, quizId);
		if (again.applied) return { revision: again.revision };
	} else {
		const holder = await getQuiz(ctx, current.value);
		if (holder) return fail("LESSON_HAS_QUIZ", `That lesson already has the quiz "${holder.title}". Each lesson has one quiz: choose another lesson, or move that quiz first.`);
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
	change: (current: Quiz | null) => Omit<Quiz, "updatedAt" | "rev"> | Fail,
): Promise<{ ok: true; id: string; quiz: Quiz } | Fail> {
	const key = id ?? newId();
	const current = id ? await ctx.storage.quizzes!.getVersioned(id) : null;
	if (id && !current) return fail("QUIZ_NOT_FOUND", "That quiz no longer exists.");
	const row = current ? parse(quizSchema, current.value) : null;
	if (id && (row?.rev ?? "") !== (rev ?? "")) return STALE("quiz");
	const changed = change(row);
	if ("ok" in changed) return changed;
	if (changed.questions.length > MAX_QUESTIONS) return TOO_MANY;
	for (const q of changed.questions) {
		const problem = questionProblem(q);
		if (problem) return fail("INVALID_QUESTION", problem);
	}
	const next = parse(quizSchema, { ...changed, updatedAt: nowIso(), rev: newRev() });
	if (!next) return fail("INVALID_QUIZ", "Give the quiz a title under 200 characters, and keep each question and answer short.");
	const before = row?.lessonKey ?? "";
	let claim: { revision: string } | null = null;
	if (next.lessonKey && next.lessonKey !== before) {
		const lesson = await ctx.content!.get("lms_lessons", next.lessonKey).catch(() => null);
		if (!lesson) return fail("LESSON_NOT_FOUND", "That lesson no longer exists. Choose another one.");
		const held = await claimLesson(ctx, next.lessonKey, key);
		if ("ok" in held) return held;
		claim = held;
	}
	const write = await ctx.storage.quizzes!.compareAndSet(key, current?.revision ?? null, next);
	if (!write.applied) {
		if (claim) await ctx.kv.compareAndDelete(lessonMarker(next.lessonKey), claim.revision).catch(() => undefined);
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
		return { id: item.id, title: row?.title ?? "Quiz that needs fixing", questions: row?.questions.length ?? 0, updatedAt: row?.updatedAt ?? "", rev: row?.rev ?? "" };
	});
	return { items, cursor: page.hasMore ? page.cursor : undefined };
}
