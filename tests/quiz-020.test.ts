import { afterEach, describe, expect, it } from "vitest";

import { readAttempt } from "../src/lib/attempts";
import { quiz as quizSchema } from "../src/schemas";
import { ana, courseWithOutline, member, openSite, QUIZ, quizOnLesson, type Site } from "./site";

/** 0.2.0: pass mark (#28), more question types (#29), retakes (#30), practice mode (#31), upgrade from 0.1.x. */

let site: Site | undefined;
afterEach(async () => {
	await site?.dispose();
	site = undefined;
});
const open = async () => (site = await openSite());
const root = member("root", 50);
type R = { blocks: Array<Record<string, any>>; toast?: { type: string; message: string } };

const ALL_TYPES = [
	{ type: "choice", prompt: "Pick C", answers: ["A", "B", "C", "D"], correct: 2, explain: "C is the third letter." },
	{ type: "multi", prompt: "Pick the vowels", answers: ["A", "B", "E", "F"], correct: [0, 2], explain: "A and E are vowels." },
	{ type: "true_false", prompt: "The sky is blue", correct: 0 },
	{ type: "short", prompt: "Capital of France?", accepted: ["Paris"], explain: "SECRET-EXPLAIN" },
	{ type: "blank", prompt: "Water boils at ___ degrees.", accepted: ["100", "one hundred"] },
];
const typed = (extra: Record<string, unknown> = {}) => ({ ...QUIZ, questions: ALL_TYPES, ...extra });
const RIGHT = [2, [2, 0], 0, "  pARIS ", "One   Hundred"];

/** A published Open course whose one lesson carries `quiz`, the member enrolled. */
async function lessonWithQuiz(s: Site, quiz: Record<string, unknown>) {
	const { course, lessons } = await courseWithOutline(s, 2);
	const lesson = lessons[0]!.id;
	await s.rt.fixtures.plugin.storage("quizzes", "q1", { ...quiz, lessonKey: lesson });
	await s.rt.fixtures.plugin.kv(`state:lesson-quiz:${lesson}`, "q1");
	await s.post("enroll", { course }, ana);
	return { course, lesson, lessons };
}

describe("passing score (#28)", () => {
	it("a graded quiz with a pass mark blocks completing its lesson until the best attempt passes", async () => {
		const s = await open();
		const { course, lesson } = await lessonWithQuiz(s, { ...QUIZ, passMark: 60 });
		expect((await s.post("completeLesson", { course, lesson }, ana)).error?.code).toBe("QUIZ_NOT_PASSED");
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana)).toMatchObject({ ok: true, percent: 50, passed: false });
		expect((await s.post("completeLesson", { course, lesson }, ana)).error?.code).toBe("QUIZ_NOT_PASSED");
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).toMatchObject({ percent: 100, passed: true, best: 100 });
		// The best score counts: a worse attempt later keeps the pass.
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [0, 1] }, ana)).toMatchObject({ percent: 0, passed: true, best: 100 });
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
	});

	it("rounds down: 2 of 3 (66.7%) misses a pass mark of 67 and meets 66", async () => {
		const s = await open();
		const three = { ...QUIZ, questions: [...QUIZ.questions, QUIZ.questions[1]], passMark: 67 };
		const { course, lesson } = await lessonWithQuiz(s, three);
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0, 1] }, ana)).toMatchObject({ percent: 66, passed: false });
		expect((await s.post("completeLesson", { course, lesson }, ana)).error?.code).toBe("QUIZ_NOT_PASSED");
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("quizzes", "q1");
		await s.rt.fixtures.plugin.storage("quizzes", "q1", { ...row, passMark: 66 });
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
	});

	it("fails closed: a lesson whose stored quiz no longer reads cannot be marked complete", async () => {
		const s = await open();
		const { course, lesson } = await lessonWithQuiz(s, { ...QUIZ, questions: [{ type: "essay", prompt: "Write" }] });
		expect((await s.post("completeLesson", { course, lesson }, ana)).error?.code).toBe("QUIZ_INVALID");
	});

	it("no pass mark never blocks; a lesson already done stays done when a pass mark is added", async () => {
		const s = await open();
		const { course, lesson } = await lessonWithQuiz(s, QUIZ);
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("quizzes", "q1");
		await s.rt.fixtures.plugin.storage("quizzes", "q1", { ...row, passMark: 90 });
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
	});

	it("a practice quiz never blocks, even with a pass mark stored", async () => {
		const s = await open();
		const { course, lesson } = await lessonWithQuiz(s, { ...QUIZ, mode: "practice", passMark: 90 });
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
		expect((await s.get("quiz", { lesson })).quiz).not.toHaveProperty("passMark");
	});

	it("progress names each lesson's pass state; Your courses counts passed quizzes", async () => {
		const s = await open();
		const { course, lesson, lessons } = await lessonWithQuiz(s, { ...QUIZ, passMark: 50 });
		expect((await s.get("progress", { course }, ana)).quizzes).toEqual({ [lesson]: { passMark: 50, best: null, passed: false } });
		await s.post("submitQuiz", { quiz: "q1", answers: [2, 1] }, ana);
		expect((await s.get("progress", { course }, ana)).quizzes).toEqual({ [lesson]: { passMark: 50, best: 50, passed: true } });
		expect(((await s.get("myCourses", {}, ana)).items as Array<Record<string, unknown>>)[0]).toMatchObject({ course, quizzesPassed: 1 });
		expect(lessons).toHaveLength(2);
	});

	it("the quiz routes show the pass mark of a graded quiz and the member's standing", async () => {
		const s = await open();
		const { lesson } = await lessonWithQuiz(s, { ...QUIZ, passMark: 80 });
		expect((await s.get("quiz", { lesson })).quiz).toMatchObject({ mode: "graded", passMark: 80 });
		expect(await s.get("quiz", { lesson })).not.toHaveProperty("mine");
		await s.post("submitQuiz", { quiz: "q1", answers: [2, 1] }, ana);
		expect((await s.get("memberQuiz", { lesson }, ana)).mine).toEqual({ attempts: 1, best: 50, passed: false, attemptsLeft: null, retryAt: null });
	});
});

describe("more question types (#29)", () => {
	it("grades multiple answers as an exact set, and typed answers ignoring case and extra spacing", async () => {
		const s = await open();
		await lessonWithQuiz(s, typed());
		expect(await s.post("submitQuiz", { quiz: "q1", answers: RIGHT }, ana)).toMatchObject({ ok: true, score: 5, total: 5, right: [true, true, true, true, true] });
		const wrong = await s.post("submitQuiz", { quiz: "q1", answers: [2, [0], 0, "Lyon", "100 degrees"] }, ana);
		expect(wrong).toMatchObject({ score: 2, right: [true, false, true, false, false] });
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, [], 0, "Paris", "100"] }, ana)).error?.code).toBe("ANSWER_EVERY_QUESTION");
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, [0, 2], 0, "   ", "100"] }, ana)).error?.code).toBe("ANSWER_EVERY_QUESTION");
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [[2], [0, 2], 0, "Paris", "100"] }, ana)).error?.code).toBe("ANSWER_EVERY_QUESTION");
	});

	it("the public and member quiz routes never send correct or accepted answers or explanations", async () => {
		const s = await open();
		const { lesson } = await lessonWithQuiz(s, typed({ mode: "practice" }));
		for (const out of [await s.get("quiz", { lesson }), await s.get("memberQuiz", { lesson }, ana)]) {
			const text = JSON.stringify(out);
			for (const secret of ["correct", "accepted", "explain", "Paris", "one hundred", "SECRET-EXPLAIN", "vowels."]) expect(text, secret).not.toContain(secret);
			expect((out.quiz as { questions: unknown[] }).questions).toEqual([
				{ type: "choice", prompt: "Pick C", answers: ["A", "B", "C", "D"] },
				{ type: "multi", prompt: "Pick the vowels", answers: ["A", "B", "E", "F"] },
				{ type: "true_false", prompt: "The sky is blue" },
				{ type: "short", prompt: "Capital of France?" },
				{ type: "blank", prompt: "Water boils at ___ degrees." },
			]);
		}
	});

	it("essays stay out; a blank question needs its ___ on the Quizzes page", async () => {
		expect(quizSchema.safeParse(typed({ questions: [{ type: "essay", prompt: "Write" }] })).success).toBe(false);
		expect(quizSchema.safeParse(typed({ questions: [{ type: "short", prompt: "Q", accepted: [] }] })).success).toBe(false);
		expect(quizSchema.safeParse(typed({ questions: [{ type: "multi", prompt: "Q", answers: ["a", "b", "c", "d"], correct: [] }] })).success).toBe(false);
	});
});

describe("practice mode (#31)", () => {
	it("only a practice quiz's submit response carries each right answer and explanation", async () => {
		const s = await open();
		await lessonWithQuiz(s, typed({ mode: "practice" }));
		const out = await s.post("submitQuiz", { quiz: "q1", answers: [0, [0], 1, "Lyon", "90"] }, ana);
		expect(out).toMatchObject({ ok: true, mode: "practice", score: 0, passed: null });
		expect(out.review).toEqual([
			{ correct: 2, explain: "C is the third letter." },
			{ correct: [0, 2], explain: "A and E are vowels." },
			{ correct: 0 },
			{ correct: ["Paris"], explain: "SECRET-EXPLAIN" },
			{ correct: ["100", "one hundred"] },
		]);
	});

	it("a graded quiz's submit response carries no right answers or explanations", async () => {
		const s = await open();
		await lessonWithQuiz(s, typed());
		const g = await s.post("submitQuiz", { quiz: "q1", answers: [0, [0], 1, "Lyon", "90"] }, ana);
		expect(g.ok).toBe(true);
		expect(JSON.stringify(g)).not.toMatch(/review|explain|Paris|correct/);
	});
});

describe("retakes and limits (#30)", () => {
	it("a maximum number of attempts: attempts left shrink, then the submit is refused and nothing is stored", async () => {
		const s = await open();
		const { lesson } = await lessonWithQuiz(s, { ...QUIZ, retake: { type: "max", attempts: 2 } });
		expect((await s.get("memberQuiz", { lesson }, ana)).mine).toMatchObject({ attemptsLeft: 2 });
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana)).toMatchObject({ attempts: 1, attemptsLeft: 1 });
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).toMatchObject({ attempts: 2, attemptsLeft: 0 });
		const refused = await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana);
		expect(refused).toMatchObject({ ok: false, error: { code: "NO_ATTEMPTS_LEFT" }, attemptsLeft: 0 });
		expect((await s.rt.inspect.storage.get<{ attempts: number }>("attempts", "ana:q1"))!.attempts).toBe(2);
	});

	it("a wait before retrying: the submit is refused with the time the member may retry, then allowed after it", async () => {
		const s = await open();
		const { lesson } = await lessonWithQuiz(s, { ...QUIZ, retake: { type: "wait", minutes: 30 } });
		const first = await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		expect(Date.parse(String(first.retryAt)) - Date.now()).toBeGreaterThan(29 * 60_000);
		const refused = await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana);
		expect(refused).toMatchObject({ ok: false, error: { code: "RETRY_LATER" } });
		expect(refused.retryAt).toBe(first.retryAt);
		expect((await s.get("memberQuiz", { lesson }, ana)).mine).toMatchObject({ retryAt: first.retryAt });
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("attempts", "ana:q1");
		await s.rt.fixtures.plugin.storage("attempts", "ana:q1", { ...row, submittedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).toMatchObject({ ok: true, attempts: 2 });
	});

	it("keeps a capped history of attempts inside the one attempt row and counts every attempt", async () => {
		const s = await open();
		await lessonWithQuiz(s, QUIZ);
		for (let i = 0; i < 23; i += 1) await s.post("submitQuiz", { quiz: "q1", answers: [i === 3 ? 2 : 0, 0] }, ana);
		const rows = await s.rt.inspect.storage.list<Record<string, any>>("attempts");
		expect(rows).toHaveLength(1);
		expect(rows[0]!.data).toMatchObject({ attempts: 23, best: 100 });
		expect(rows[0]!.data.history).toHaveLength(20);
	});

	it("Quiz results list attempts and the best score; erase removes the history with the row", async () => {
		const s = await open();
		await lessonWithQuiz(s, QUIZ);
		await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana);
		await s.post("submitQuiz", { quiz: "q1", answers: [0, 1] }, ana);
		const page = (await s.rt.admin.loadPage("/results", { user: root })) as R;
		const table = page.blocks.find((b) => b.type === "table")!;
		expect(table.columns.map((c: { label: string }) => c.label)).toEqual(["Member", "Quiz and latest score", "Best", "Attempts", "Actions"]);
		expect(table.rows[0]).toMatchObject({ best: "100%", attempts: 2 });
		expect(table.rows[0].quiz).toContain("0 of 2");
		await s.post("eraseMember", {}, ana);
		expect(await s.rt.inspect.storage.list("attempts")).toHaveLength(0);
	});
});

describe("erase and retake limits (owner, 2026-11-15)", () => {
	it("a member's own erase keeps attempts used: a submit past the limit is still refused, and the quiz shows none left", async () => {
		const s = await open();
		const { lesson } = await lessonWithQuiz(s, { ...QUIZ, retake: { type: "max", attempts: 2 } });
		await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana);
		expect((await s.post("eraseMember", {}, ana)).done).toBe(true);
		expect(await s.rt.inspect.storage.list("attempts")).toHaveLength(0);
		expect(await s.rt.inspect.storage.list("enrollments")).toHaveLength(0);
		// Only attempts used and the last time remain: no answers, scores or progress.
		const kept = JSON.stringify(await s.rt.inspect.kv.get("state:retake:ana:q1"));
		expect(kept).toContain('"attempts":2');
		expect(kept).not.toMatch(/score|answers|best|done/);
		expect((await s.get("memberQuiz", { lesson }, ana)).mine).toMatchObject({ attempts: 2, attemptsLeft: 0, best: null });
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).error?.code).toBe("NO_ATTEMPTS_LEFT");
	});

	it("a wait is still enforced after the member's own erase", async () => {
		const s = await open();
		await lessonWithQuiz(s, { ...QUIZ, retake: { type: "wait", minutes: 30 } });
		const first = await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		await s.post("eraseMember", {}, ana);
		const refused = await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana);
		expect(refused.error?.code).toBe("RETRY_LATER");
		expect(refused.retryAt).toBe(first.retryAt);
	});

	it("the admin erase removes the kept record, so the member can submit again; Find reaches a member with no results", async () => {
		const s = await open();
		const id = (await s.rt.fixtures.user({ email: "real@example.com", name: "Real Member", role: "subscriber" } as never)).id as string;
		const who = { ...member(id), email: "real@example.com" };
		const { course } = await lessonWithQuiz(s, { ...QUIZ, retake: { type: "max", attempts: 1 } });
		await s.post("enroll", { course }, who);
		await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, who);
		await s.post("eraseMember", {}, who);
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, who)).error?.code).toBe("NO_ATTEMPTS_LEFT");
		// The member has no results left, so Find offers their erase anyway.
		const found = (await s.rt.admin.submit("/results", "results_find", { find: "real@example.com" }, { user: root })) as R;
		const row = found.blocks.find((b) => b.type === "table")!.rows[0];
		expect(row.member).toBe("Real Member");
		const pick = JSON.parse((row.erase.items as Array<{ value: string }>)[0]!.value);
		const out = (await s.rt.admin.act("/results", "member_erase", { value: pick, user: root })) as R;
		expect(out.toast?.type).toBe("success");
		expect(await s.rt.inspect.kv.get(`state:retake:${id}:q1`)).toBeNull();
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, who)).toMatchObject({ ok: true, attempts: 1 });
	});

	it("0.2.1 (#35): the member's erase keeps attempts used on a quiz that is unlimited now, so limiting it later still counts them", async () => {
		const s = await open();
		await lessonWithQuiz(s, { ...QUIZ, retake: { type: "max", attempts: 3 } });
		const setRetake = async (retake: Record<string, unknown>) => {
			const row = await s.rt.inspect.storage.get<Record<string, unknown>>("quizzes", "q1");
			await s.rt.fixtures.plugin.storage("quizzes", "q1", { ...row, retake });
		};
		for (let i = 0; i < 2; i += 1) await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		await setRetake({ type: "unlimited" });
		for (let i = 0; i < 5; i += 1) await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		expect((await s.post("eraseMember", {}, ana)).done).toBe(true);
		const kept = JSON.stringify(await s.rt.inspect.kv.get("state:retake:ana:q1"));
		expect(kept).toContain('"attempts":7');
		expect(kept).not.toMatch(/score|answers|best|done/);
		await setRetake({ type: "max", attempts: 3 });
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).error?.code).toBe("NO_ATTEMPTS_LEFT");
	});

	it("0.2.1 (#35): a quiz that was never limited keeps its count through the member's erase", async () => {
		const s = await open();
		const { lesson } = await lessonWithQuiz(s, QUIZ);
		for (let i = 0; i < 2; i += 1) await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		await s.post("eraseMember", {}, ana);
		expect(await s.rt.inspect.storage.list("attempts")).toHaveLength(0);
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("quizzes", "q1");
		await s.rt.fixtures.plugin.storage("quizzes", "q1", { ...row, retake: { type: "max", attempts: 2 } });
		expect((await s.get("memberQuiz", { lesson }, ana)).mine).toMatchObject({ attempts: 2, attemptsLeft: 0 });
	});

	it("0.2.1 (#35): the member's erase removes kept records of deleted quizzes, with or without an attempt row", async () => {
		const s = await open();
		await quizOnLesson(s, "q1", "published", { ...QUIZ, retake: { type: "max", attempts: 5 } });
		await quizOnLesson(s, "q2", "published", { ...QUIZ, retake: { type: "max", attempts: 5 } });
		await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		await s.post("submitQuiz", { quiz: "q2", answers: [0, 0] }, ana);
		// q2: the member erases first, so its record outlives the attempt row; then both quizzes go.
		await s.post("eraseMember", {}, ana);
		await s.post("submitQuiz", { quiz: "q1", answers: [0, 0] }, ana);
		const del = async (id: string) => {
			const row = await s.rt.inspect.storage.get<{ rev: string }>("quizzes", id);
			expect((await s.rt.admin.act("/quizzes", "quiz_delete", { value: { q: id, r: row!.rev }, user: root })) as R).toBeTruthy();
			expect(await s.rt.inspect.storage.get("quizzes", id)).toBeNull();
		};
		await del("q1");
		await del("q2");
		expect(await s.rt.inspect.kv.get("state:retake:ana:q2")).not.toBeNull();
		expect((await s.post("eraseMember", {}, ana)).done).toBe(true);
		expect(await s.rt.inspect.kv.get("state:retake:ana:q1")).toBeNull();
		expect(await s.rt.inspect.kv.get("state:retake:ana:q2")).toBeNull();
		expect(await s.rt.inspect.kv.get("state:retakes:ana")).toBeNull();
	});
});

describe("upgrade from 0.1.x, no migration step", () => {
	const OLD_ATTEMPT = { memberId: "ana", quizId: "q1", lessonKey: "", score: 1, total: 2, answers: [0, 0], submittedAt: "2026-11-10T00:00:00.000Z" };

	it("a 0.1.x quiz reads as graded, no pass mark, unlimited retakes, and a 0.1.x attempt becomes the first history entry", async () => {
		const s = await open();
		// QUIZ is the 0.1.x shape: no mode, pass mark, retake or explanations.
		expect(quizSchema.parse(QUIZ)).toMatchObject({ mode: "graded", retake: { type: "unlimited" } });
		expect(quizSchema.parse(QUIZ).passMark).toBeUndefined();
		const { course, lesson } = await lessonWithQuiz(s, QUIZ);
		await s.rt.fixtures.plugin.storage("attempts", "ana:q1", { ...OLD_ATTEMPT, lessonKey: lesson });
		expect(readAttempt(OLD_ATTEMPT)).toMatchObject({ attempts: 1, best: 50, history: [{ score: 1, total: 2, submittedAt: OLD_ATTEMPT.submittedAt }] });
		expect((await s.get("memberQuiz", { lesson }, ana)).mine).toEqual({ attempts: 1, best: 50, passed: null, attemptsLeft: null, retryAt: null });
		const results = (await s.rt.admin.loadPage("/results", { user: root })) as R;
		expect(results.blocks.find((b) => b.type === "table")!.rows[0]).toMatchObject({ best: "50%", attempts: 1 });
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
		await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana);
		const row = (await s.rt.inspect.storage.get<Record<string, any>>("attempts", "ana:q1"))!;
		expect(row).toMatchObject({ attempts: 2, best: 100 });
		expect(row.history[0]).toEqual({ score: 1, total: 2, submittedAt: OLD_ATTEMPT.submittedAt });
		expect(row.history).toHaveLength(2);
	});

	it("an owner adding a pass mark to a 0.1.x quiz: the old best counts against it", async () => {
		const s = await open();
		const { course, lesson } = await lessonWithQuiz(s, { ...QUIZ, passMark: 50 });
		await s.rt.fixtures.plugin.storage("attempts", "ana:q1", { ...OLD_ATTEMPT, lessonKey: lesson });
		expect((await s.post("completeLesson", { course, lesson }, ana)).ok).toBe(true);
	});
});

describe("Quizzes page (admin) for 0.2.0", () => {
	async function made(s: Site) {
		const page = (await s.rt.admin.submit("/quizzes", "quiz_create", { title: "Types" }, { user: root })) as R;
		expect(page.toast?.type).toBe("success");
		return (await s.rt.inspect.storage.list<{ title: string }>("quizzes"))[0]!.id;
	}
	const rev = async (s: Site, id: string) => (await s.rt.inspect.storage.get<{ rev: string }>("quizzes", id))!.rev;

	it("sets mode, pass mark and retake policy, and refuses an out-of-range pass mark", async () => {
		const s = await open();
		const id = await made(s);
		let page = (await s.rt.admin.submit("/quizzes", "quiz_settings", { mode: "graded", pass_mark: 120, retake: "unlimited" }, { blockId: `qs|${id}|${await rev(s, id)}`, user: root })) as R;
		expect(page.toast).toMatchObject({ type: "error", message: expect.stringContaining("1 to 100") });
		page = (await s.rt.admin.submit("/quizzes", "quiz_settings", { mode: "graded", pass_mark: 70, retake: "max", attempts: 3 }, { blockId: `qs|${id}|${await rev(s, id)}`, user: root })) as R;
		expect(page.toast?.type).toBe("success");
		expect(await s.rt.inspect.storage.get("quizzes", id)).toMatchObject({ mode: "graded", passMark: 70, retake: { type: "max", attempts: 3 } });
		expect(JSON.stringify(page.blocks)).toContain("pass mark 70%");
		page = (await s.rt.admin.submit("/quizzes", "quiz_settings", { mode: "practice", pass_mark: 70, retake: "wait", minutes: 15 }, { blockId: `qs|${id}|${await rev(s, id)}`, user: root })) as R;
		const stored = await s.rt.inspect.storage.get<Record<string, unknown>>("quizzes", id);
		expect(stored).toMatchObject({ mode: "practice", retake: { type: "wait", minutes: 15 } });
		expect(stored!.passMark).toBeUndefined();
		// A second tab with the old token is refused.
		expect(((await s.rt.admin.submit("/quizzes", "quiz_settings", { mode: "graded", pass_mark: 0, retake: "unlimited" }, { blockId: `qs|${id}|old`, user: root })) as R).toast?.type).toBe("error");
	});

	it("adds each new question type with its own fields and an explanation", async () => {
		const s = await open();
		const id = await made(s);
		const add = async (values: Record<string, unknown>) => (await s.rt.admin.submit("/quizzes", "question_add", values, { blockId: `qa|${id}|${await rev(s, id)}`, user: root })) as R;
		expect((await add({ type: "multi", prompt: "Vowels?", manswer_0: "A", manswer_1: "B", manswer_2: "E", manswer_3: "F", correct_multi: ["0", "2"], explain: "A and E." })).toast?.type).toBe("success");
		expect((await add({ type: "multi", prompt: "None ticked", manswer_0: "A", manswer_1: "B", manswer_2: "E", manswer_3: "F", correct_multi: [] })).toast?.type).toBe("error");
		expect((await add({ type: "short", prompt: "Capital of France?", accepted_short: "Paris\n paris \n" })).toast?.type).toBe("success");
		expect((await add({ type: "blank", prompt: "No blank marked", accepted_blank: "x" })).toast).toMatchObject({ type: "error", message: expect.stringContaining("___") });
		const last = await add({ type: "blank", prompt: "Water boils at ___ degrees.", accepted_blank: "100" });
		expect(last.toast?.type).toBe("success");
		const rows = last.blocks.find((b) => b.type === "table")!.rows;
		expect(rows.map((r: Record<string, unknown>) => r.kind)).toEqual(["Multiple answers (pick all that apply)", "Short answer", "Fill in the blank"]);
		expect(rows[0].answer).toBe("A, E");
		const stored = await s.rt.inspect.storage.get<{ questions: unknown[] }>("quizzes", id);
		expect(stored!.questions).toEqual([
			{ type: "multi", prompt: "Vowels?", answers: ["A", "B", "E", "F"], correct: [0, 2], explain: "A and E." },
			{ type: "short", prompt: "Capital of France?", accepted: ["Paris", "paris"] },
			{ type: "blank", prompt: "Water boils at ___ degrees.", accepted: ["100"] },
		]);
	});
});

describe("MCP saveQuiz and getQuiz for 0.2.0", () => {
	it("take and return mode, pass mark, retake policy and every question type; leaving them out keeps them, null removes the pass mark", async () => {
		const s = await open();
		const call = (name: string, input: unknown) => s.rt.transport.invokeRoute(`tools/${name}`, input, { method: "POST", user: root } as never) as Promise<Record<string, any>>;
		const made = await call("saveQuiz", { title: "Agent quiz", questions: ALL_TYPES, mode: "graded", passMark: 75, retake: { type: "max", attempts: 2 } });
		expect(made.ok).toBe(true);
		let got = await call("getQuiz", { quiz: made.id });
		expect(got).toMatchObject({ mode: "graded", passMark: 75, retake: { type: "max", attempts: 2 } });
		expect(got.questions).toEqual(ALL_TYPES);
		const kept = await call("saveQuiz", { quiz: made.id, title: "Renamed", questions: ALL_TYPES, rev: got.rev });
		expect(kept.quiz).toMatchObject({ title: "Renamed", passMark: 75, retake: { type: "max", attempts: 2 } });
		const cleared = await call("saveQuiz", { quiz: made.id, title: "Renamed", questions: ALL_TYPES, passMark: null, rev: kept.quiz.rev });
		got = await call("getQuiz", { quiz: made.id });
		expect(cleared.ok).toBe(true);
		expect(got.passMark).toBeUndefined();
		expect((await call("saveQuiz", { title: "Bad", questions: [], passMark: 0 })).error.code).toBe("INVALID_INPUT");
		// A practice quiz keeps no pass mark (SCOPE 0.2.0), from the MCP tool too.
		const practice = await call("saveQuiz", { title: "Practice", questions: ALL_TYPES, mode: "practice", passMark: 80 });
		expect((await call("getQuiz", { quiz: practice.id })).passMark).toBeUndefined();
	});
});
