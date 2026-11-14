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

/**
 * The one writer of quizzes. `change` gets the stored quiz (or null for a new one) and returns the
 * quiz to store or a refusal. A stale version token is refused. Two calls: getVersioned and the write
 * (one for a new quiz).
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
	const write = await ctx.storage.quizzes!.compareAndSet(key, current?.revision ?? null, next);
	return write.applied ? { ok: true, id: key, quiz: next } : STALE("quiz");
}

/** Delete with the version token the owner saw. Two calls. */
export async function deleteQuiz(ctx: Ctx, id: string, rev: string): Promise<{ ok: true; title: string } | Fail> {
	const current = await ctx.storage.quizzes!.getVersioned(id);
	if (!current) return fail("QUIZ_NOT_FOUND", "That quiz is already gone.");
	const row = parse(quizSchema, current.value);
	if ((row?.rev ?? "") !== rev) return STALE("quiz");
	const done = await ctx.storage.quizzes!.compareAndDelete(id, current.revision);
	return done.applied ? { ok: true, title: row?.title ?? "" } : STALE("quiz");
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
