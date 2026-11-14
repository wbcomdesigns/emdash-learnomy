// The counter must load before anything that starts the test host.
import { countBridgeCalls } from "./bridge-count";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ana, ben, courseWithOutline, openSite, QUIZ, type Site } from "./site";

/** Learnomy's cap per entry point (SCOPE: EmDash 1.5 gives 30 on Cloudflare; we keep 20). */
const CAP = 20;

/**
 * Bridge calls per entry point at its worst case, measured and pinned: a change that moves one shows
 * up here. The busy site: a 200-lesson outline, a 20-question quiz, and a member with 500
 * enrollments and 500 attempts to erase. completeLesson retries once when another tab wrote between its
 * read and write: its ceiling is 5 (outline get, then getVersioned + compareAndSet twice), never measured
 * here because the test host runs one call at a time.
 */
const MEASURED: Record<string, number> = {
	"route outline (200 lessons)": 1,
	"route quiz (20 questions)": 1,
	"route enroll": 2,
	"route enroll (second time)": 2,
	"route completeLesson (last lesson of 200)": 3,
	"route completeLesson (already done)": 2,
	"route completeLesson (not in outline)": 1,
	"route submitQuiz (20 questions)": 2,
	"route eraseMember (500 + 500 rows, each round)": 18,
	"admin page_load /outline": 0,
	"admin page_load /quizzes": 0,
};

const seen = new Map<string, number>();

describe("bridge calls per entry point, worst case", () => {
	let s: Site;
	let course = "";
	let lessons: Array<{ id: string }> = [];

	async function measure(name: string, call: () => Promise<unknown>) {
		const { result, calls } = await countBridgeCalls(call);
		seen.set(name, Math.max(seen.get(name) ?? 0, calls.length));
		expect(calls.length, `${name}: ${calls.join(", ")}`).toBeLessThanOrEqual(MEASURED[name] ?? CAP);
		return result as Record<string, unknown>;
	}

	beforeAll(async () => {
		s = await openSite();
		({ course, lessons } = await courseWithOutline(s, 200));
		await s.rt.fixtures.plugin.storage("quizzes", "q20", { ...QUIZ, questions: Array.from({ length: 20 }, () => QUIZ.questions[0]) });
		const at = "2026-11-15T00:00:00.000Z";
		for (let i = 0; i < 500; i += 1) {
			await s.rt.fixtures.plugin.storage("enrollments", `ben:c${i}`, { memberId: "ben", courseKey: `c${i}`, courseTitle: "", startedAt: at, updatedAt: at, completedAt: null, done: [] });
			await s.rt.fixtures.plugin.storage("attempts", `ben:q${i}`, { memberId: "ben", quizId: `q${i}`, lessonKey: "", score: 0, total: 1, answers: [0], submittedAt: at });
		}
	}, 120_000);
	afterAll(() => s.dispose());

	it("public routes", async () => {
		await measure("route outline (200 lessons)", () => s.get("outline", { course }));
		await measure("route quiz (20 questions)", () => s.get("quiz", { quiz: "q20" }));
	});

	it("member routes", async () => {
		expect((await measure("route enroll", () => s.post("enroll", { course }, ana))).ok).toBe(true);
		await measure("route enroll (second time)", () => s.post("enroll", { course }, ana));
		await measure("route completeLesson (not in outline)", () => s.post("completeLesson", { course, lesson: "nope" }, ana));
		// 199 lessons already done, as a fixture, then the last one through the route.
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("enrollments", `ana:${course}`);
		await s.rt.fixtures.plugin.storage("enrollments", `ana:${course}`, { ...row, done: lessons.slice(0, 199).map((l) => l.id) });
		const last = await measure("route completeLesson (last lesson of 200)", () => s.post("completeLesson", { course, lesson: lessons[199]!.id }, ana));
		expect((last.enrollment as { completedAt: string | null }).completedAt).toBeTruthy();
		await measure("route completeLesson (already done)", () => s.post("completeLesson", { course, lesson: lessons[0]!.id }, ana));
		await measure("route submitQuiz (20 questions)", () => s.post("submitQuiz", { quiz: "q20", answers: Array(20).fill(2) }, ana));
		let done = false;
		for (let round = 0; round < 20 && !done; round += 1) {
			done = (await measure("route eraseMember (500 + 500 rows, each round)", () => s.post("eraseMember", {}, ben))).done === true;
		}
		expect(done).toBe(true);
	});

	it("admin pages", async () => {
		await measure("admin page_load /outline", () => s.rt.admin.loadPage("/outline"));
		await measure("admin page_load /quizzes", () => s.rt.admin.loadPage("/quizzes"));
	});

	it("every entry point measured, none over the cap", () => {
		expect([...seen.keys()].sort()).toEqual(Object.keys(MEASURED).sort());
		for (const [name, n] of seen) expect(n, name).toBeLessThanOrEqual(CAP);
		console.log(Object.fromEntries(seen));
	});
});
