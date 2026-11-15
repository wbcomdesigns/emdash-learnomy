// The counter must load before anything that starts the test host.
import { countBridgeCalls } from "./bridge-count";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ana, courseWithOutline, member, openSite, QUIZ, quizOnLesson, type Site } from "./site";

/** Learnomy's cap per entry point (SCOPE: EmDash 1.5 gives 30 on Cloudflare; we keep 20). */
const CAP = 20;

/**
 * Bridge calls per entry point at its worst case, measured and pinned: a change that moves one shows
 * up here. The busy site: 520 members, 600 course outlines, one of 200 lessons, 30 courses and 30
 * lessons, a 20-question quiz, 15 members with enrollments and results on the first list page, and a
 * member with 500 enrollments and 500 attempts to erase. completeLesson retries once when another tab
 * wrote between its read and write: its ceiling is 7 (outline get, the lesson's quiz, the member's
 * attempt, then getVersioned + compareAndSet twice), never measured here because the test host runs one call at a time.
 */
// The public outline reads published lessons 100 a page until it has found every outline lesson:
// 2 + 15 = 17 at most (a site with 1,500 or more published lessons); measured here on 262. catalog: 1 + 3 + 15 =
// 19 at most; lessonCourses: 1 + 5 + 10 = 16 at most (the outline scan reads 500 outlines, 5 pages).
// Once the lessons still missing fit in the calls left, they are looked up by id (findPublished), so a
// draft lesson costs one call instead of the full scan. The public quiz route for a guest adds the
// lessonCourses scan to its 2: 17 at most. myCourses: 2 + 2 (the member's attempts and their quizzes,
// 0.2.0) + 3 + 12 = 19 at most. completeLesson: 1 + 1 (the lesson's quiz) + 1 (the member's attempt
// when that quiz has a pass mark) + 13 (status of the lessons left, none once all are done) + 2 + 2
// (one retry) = 20 at most. progress: 2 + 3 (quizzes on a 200-lesson outline, 80 lessons a query) + 1
// (attempts) = 6 at most. memberQuiz: 4 (with the kept retake record). submitQuiz: 5 (quiz, lesson, attempt getVersioned, the kept retake record, compareAndSet); with
// a retake limit the kept record's compare-and-set adds 1, 3 on a conflict: 8 at most.
const MEASURED: Record<string, number> = {
	"route outline (200 lessons, 262 published on the site)": 5,
	"route quiz (guest, lesson in no course, 600 outlines)": 7,
	"route memberQuiz (20 questions)": 4,
	"route completeLesson (graded quiz with a pass mark, not passed)": 4,
	"route completeLesson (graded quiz with a pass mark, passed)": 8,
	"route progress (3 pass-mark quizzes on 200 lessons)": 6,
	"route outline (a draft lesson in the outline, 262 published on the site)": 5,
	"route outline (3 lessons and a draft, 262 published on the site)": 4,
	"route completeLesson (last published lesson, a draft left in the outline)": 6,
	"route enroll": 2,
	"route enroll (second time)": 2,
	"route completeLesson (last lesson of 200)": 4,
	"route completeLesson (already done)": 4,
	"route completeLesson (not in outline)": 2,
	"route submitQuiz (20 questions)": 5,
	"route submitQuiz (retake limit, keeps the count)": 6,
	"route eraseMember (500 + 500 rows, each round)": 18,
	"admin page_load /outline": 3,
	"admin page_load /outline (opened from the lesson panel)": 14,
	"admin courses_page": 2,
	"admin outline_open (200 lessons, 10 shown)": 12,
	"admin outline_add (30 lessons)": 3,
	"admin outline_put": 8,
	"admin outline_up": 16,
	"admin outline_remove": 16,
	"admin page_load /quizzes": 2,
	"admin quiz_create": 1,
	"admin quiz_open": 1,
	"admin question_add": 2,
	"admin question_add (refused, form shown again)": 2,
	"admin question_save": 2,
	"admin question_menu (remove asks first)": 1,
	"admin question_remove": 2,
	"admin quiz_delete": 5,
	"admin page_load /enrollments (15 members)": 18,
	"admin enrollments_find (name, 520 members)": 7,
	"admin enrollments_find (email)": 4,
	"admin enrollments_page (Find by name, page 2)": 8,
	"admin page_load /results (15 members)": 18,
	"admin member_menu (asks first)": 0,
	"admin member_erase (500 + 500 rows, each round)": 18,
	"admin widget summary": 3,
	"panel load (600 outlines)": 6,
	"panel open_outline": 1,
	"tool getOutline": 1,
	"tool setOutline (15 new lessons)": 18,
	"tool listQuizzes": 1,
	"tool getQuiz": 1,
	"tool saveQuiz (replace)": 2,
	"tool deleteQuiz": 4,
	"tool listEnrollments": 18,
	"tool listResults": 18,
	"admin quiz_lessons (30 lessons)": 3,
	"admin quiz_lesson_set (claims a lesson, frees the old one)": 7,
	"admin quiz_lesson_set (lesson taken, refused)": 8,
	"admin page_load /quizzes (opened from the lesson panel)": 4,
	"panel open_quiz": 1,
	"tool saveQuiz (new, on a lesson)": 3,
	"route catalog (24 courses)": 5,
	"route lessonCourses (600 outlines)": 7,
	"route progress": 6,
	"route myCourses (50 enrollments)": 5,
	"hook page:metadata (200 lessons, 262 published on the site)": 5,
	"hook plugin:install": 3, // 2 measured: the test host already ran install at start; 3 on a site with no marker
	"hook plugin:activate (marker set)": 2,
	"hook cron daily (marker current)": 1,
	"hook cron daily (older marker)": 2,
};

const seen = new Map<string, number>();
const root = member("root", 50);
type Out = Record<string, any>;

describe("bridge calls per entry point, worst case", () => {
	let s: Site;
	let course = "";
	let lessons: Array<{ id: string }> = [];
	const loose: string[] = [];
	const members: string[] = [];
	let q20Lesson = "";

	async function measure(name: string, call: () => Promise<unknown>): Promise<Out> {
		const { result, calls } = await countBridgeCalls(call);
		seen.set(name, Math.max(seen.get(name) ?? 0, calls.length));
		expect(calls.length, `${name}: ${calls.join(", ")}`).toBeLessThanOrEqual(MEASURED[name] ?? CAP);
		return result as Out;
	}
	const tool = (name: string, input: unknown) => s.rt.transport.invokeRoute(`tools/${name}`, input, { method: "POST", user: root } as never) as Promise<Out>;

	beforeAll(async () => {
		s = await openSite();
		({ course, lessons } = await courseWithOutline(s, 200));
		for (let i = 0; i < 30; i += 1) await s.entry("lms_courses", `Course ${String(i).padStart(2, "0")}`);
		for (let i = 0; i < 30; i += 1) loose.push(await s.entry("lms_lessons", `Loose ${String(i).padStart(2, "0")}`));
		const at = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 60_000).toISOString();
		for (let i = 0; i < 600; i += 1) await s.rt.fixtures.plugin.storage("outlines", `other-${i}`, { courseKey: `other-${i}`, courseTitle: `Other ${i}`, lessons: [], updatedAt: at(-i), rev: "r" });
		for (let i = 0; i < 520; i += 1) members.push((await s.rt.fixtures.user({ email: `m${i}@example.com`, name: `Member ${i}`, role: "subscriber" })).id);
		q20Lesson = await quizOnLesson(s, "q20", "published", { ...QUIZ, questions: Array.from({ length: 20 }, () => QUIZ.questions[0]) });
		await quizOnLesson(s, "q1");
		// Graded quizzes with a pass mark in each 80-lesson chunk of the 200-lesson outline (0.2.0).
		for (const i of [0, 100, 150]) await s.rt.fixtures.plugin.storage("quizzes", `pm${i}`, { ...QUIZ, lessonKey: lessons[i]!.id, passMark: 50 });
		for (let i = 0; i < 15; i += 1) {
			await s.rt.fixtures.plugin.storage("enrollments", `${members[i]}:${course}`, { memberId: members[i], courseKey: course, courseTitle: "Course A", startedAt: at(1000 + i), updatedAt: at(1000 + i), completedAt: null, done: [] });
			await s.rt.fixtures.plugin.storage("attempts", `${members[i]}:q1`, { memberId: members[i], quizId: "q1", lessonKey: "", score: 1, total: 2, answers: [0, 0], submittedAt: at(1000 + i) });
		}
		for (let i = 0; i < 500; i += 1) {
			await s.rt.fixtures.plugin.storage("enrollments", `ben:c${i}`, { memberId: "ben", courseKey: `c${i}`, courseTitle: "", startedAt: at(i), updatedAt: at(i), completedAt: null, done: [] });
			await s.rt.fixtures.plugin.storage("attempts", `ben:q${i}`, { memberId: "ben", quizId: `q${i}`, lessonKey: "", score: 0, total: 1, answers: [0], submittedAt: at(i) });
		}
	}, 300_000);
	afterAll(() => s.dispose());

	it("public and member routes", async () => {
		await measure("route outline (200 lessons, 262 published on the site)", () => s.get("outline", { course }));
		expect((await measure("route quiz (guest, lesson in no course, 600 outlines)", () => s.get("quiz", { lesson: q20Lesson }))).error.code).toBe("SIGN_IN_REQUIRED");
		expect((await measure("route memberQuiz (20 questions)", () => s.get("memberQuiz", { lesson: q20Lesson }, ana))).quiz.questions).toHaveLength(20);
		expect((await measure("route enroll", () => s.post("enroll", { course }, ana))).ok).toBe(true);
		await measure("route enroll (second time)", () => s.post("enroll", { course }, ana));
		await measure("route completeLesson (not in outline)", () => s.post("completeLesson", { course, lesson: "nope" }, ana));
		expect((await measure("route completeLesson (graded quiz with a pass mark, not passed)", () => s.post("completeLesson", { course, lesson: lessons[150]!.id }, ana))).error.code).toBe("QUIZ_NOT_PASSED");
		await s.post("submitQuiz", { quiz: "pm150", answers: [2, 0] }, ana);
		expect((await measure("route completeLesson (graded quiz with a pass mark, passed)", () => s.post("completeLesson", { course, lesson: lessons[150]!.id }, ana))).ok).toBe(true);
		expect(Object.keys((await measure("route progress (3 pass-mark quizzes on 200 lessons)", () => s.get("progress", { course }, ana))).quizzes)).toHaveLength(3);
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("enrollments", `ana:${course}`);
		await s.rt.fixtures.plugin.storage("enrollments", `ana:${course}`, { ...row, done: lessons.slice(0, 199).map((l) => l.id) });
		const last = await measure("route completeLesson (last lesson of 200)", () => s.post("completeLesson", { course, lesson: lessons[199]!.id }, ana));
		expect(last.enrollment.completedAt).toBeTruthy();
		await measure("route completeLesson (already done)", () => s.post("completeLesson", { course, lesson: lessons[0]!.id }, ana));
		// A draft lesson at the end of the outline: one lookup by id, not a scan of every page.
		const draft = await s.entry("lms_lessons", "Budget draft lesson", "draft");
		const stored = await s.rt.inspect.storage.get<Record<string, any>>("outlines", course);
		await s.rt.fixtures.plugin.storage("outlines", course, { ...stored, lessons: [...stored!.lessons.slice(0, 199), { id: draft, title: "Budget draft lesson" }] });
		expect((await measure("route outline (a draft lesson in the outline, 262 published on the site)", () => s.get("outline", { course }))).lessons).toHaveLength(199);
		await s.rt.fixtures.plugin.storage("enrollments", `ana:${course}`, { ...row, done: lessons.slice(0, 198).map((l) => l.id), completedAt: null });
		const draftLeft = await measure("route completeLesson (last published lesson, a draft left in the outline)", () => s.post("completeLesson", { course, lesson: lessons[198]!.id }, ana));
		expect(draftLeft.enrollment.completedAt).toBeTruthy();
		await s.rt.fixtures.plugin.storage("outlines", course, stored);
		// A short outline with a draft: the first page finds the published ones, the draft costs one lookup
		// by id instead of reading every remaining page (5 calls before findPublished looked ids up).
		const shortCourse = (await s.rt.inspect.content.list("lms_courses")).find((c) => c.slug === "course-00")!.id;
		await s.rt.fixtures.plugin.storage("outlines", shortCourse, { courseKey: shortCourse, courseTitle: "Course 00", lessons: [...loose.slice(27, 30).map((id) => ({ id, title: "L" })), { id: draft, title: "D" }], updatedAt: "2026-11-15T00:00:00.000Z", rev: "r" });
		expect((await measure("route outline (3 lessons and a draft, 262 published on the site)", () => s.get("outline", { course: shortCourse }))).lessons).toHaveLength(3);
		await measure("route submitQuiz (20 questions)", () => s.post("submitQuiz", { quiz: "q20", answers: Array(20).fill(2) }, ana));
		await quizOnLesson(s, "lim", "published", { ...QUIZ, retake: { type: "max", attempts: 5 } });
		expect((await measure("route submitQuiz (retake limit, keeps the count)", () => s.post("submitQuiz", { quiz: "lim", answers: [2, 0] }, ana))).attemptsLeft).toBe(4);
		const ids = [course, ...Array.from({ length: 23 }, (_, i) => `other-${i}`)].join(",");
		expect((await measure("route catalog (24 courses)", () => s.get("catalog", { courses: ids }))).counts[course]).toBe(200);
		const holders = await measure("route lessonCourses (600 outlines)", () => s.get("lessonCourses", { lesson: lessons[0]!.id }));
		expect(holders.courses).toHaveLength(1);
		await measure("route progress", () => s.get("progress", { course }, ana));
		await measure("route myCourses (50 enrollments)", () => s.get("myCourses", {}, member("ben")));
		const page = { url: "https://site.test/courses/a", title: "A", description: null, canonical: null, image: null, content: { collection: "lms_courses", id: course, slug: "a" } };
		const graph = await measure("hook page:metadata (200 lessons, 262 published on the site)", () => s.rt.transport.invokeHook("page:metadata", { page }));
		expect(graph.graph.hasPart).toHaveLength(200);
	});

	it("course outline admin and lesson panel", async () => {
		const admin = s.rt.admin;
		await measure("admin page_load /outline", () => admin.loadPage("/outline", { user: root }));
		await measure("admin courses_page", () => admin.act("/outline", "courses_page", { value: {}, user: root }));
		const opened = await measure("admin outline_open (200 lessons, 10 shown)", () => admin.act("/outline", "outline_open", { value: { c: course, p: 3 }, user: root }));
		const rev = (await s.rt.inspect.storage.get<{ rev: string }>("outlines", course))!.rev;
		await measure("admin outline_up", () => admin.act("/outline", "outline_menu", { value: JSON.stringify({ a: "outline_up", c: course, i: 35, r: rev, p: 3 }), user: root }));
		const rev2 = (await s.rt.inspect.storage.get<{ rev: string }>("outlines", course))!.rev;
		await measure("admin outline_remove", () => admin.act("/outline", "outline_menu", { value: JSON.stringify({ a: "outline_remove", c: course, i: 35, r: rev2, p: 3 }), user: root }));
		expect(opened.blocks).toBeTruthy();
		await measure("admin outline_add (30 lessons)", () => admin.act("/outline", "outline_add", { value: { c: course }, user: root }));
		const rev3 = (await s.rt.inspect.storage.get<{ rev: string }>("outlines", course))!.rev;
		const put = await measure("admin outline_put", () => admin.act("/outline", "outline_put", { value: { c: course, l: loose[0], r: rev3 }, user: root }));
		expect(put.toast.type).toBe("success");
		await measure("panel load (600 outlines)", () => admin.loadEditorPanel("courses", "lms_lessons", lessons[0]!.id, { user: root }));
		await measure("panel open_outline", () => admin.actEditorPanel("courses", "lms_lessons", lessons[0]!.id, "open_outline", { value: { c: course }, user: root }));
		await measure("admin page_load /outline (opened from the lesson panel)", () => admin.loadPage("/outline", { user: root }));
	});

	it("quizzes admin", async () => {
		const admin = s.rt.admin;
		await measure("admin page_load /quizzes", () => admin.loadPage("/quizzes", { user: root }));
		const made = await measure("admin quiz_create", () => admin.submit("/quizzes", "quiz_create", { title: "Budget quiz" }, { user: root }));
		const id = (await s.rt.inspect.storage.list<{ title: string }>("quizzes")).find((q) => q.data.title === "Budget quiz")!.id;
		expect(made.toast.type).toBe("success");
		await measure("admin quiz_open", () => admin.act("/quizzes", "quiz_open", { value: { q: id }, user: root }));
		const rev = async () => (await s.rt.inspect.storage.get<{ rev: string }>("quizzes", id))!.rev;
		await measure("admin question_add", async () => admin.submit("/quizzes", "question_add", { type: "true_false", prompt: "Yes?", correct_tf: "0" }, { blockId: `qa|${id}|${await rev()}`, user: root }));
		const r1 = await rev();
		await measure("admin question_add (refused, form shown again)", () => admin.submit("/quizzes", "question_add", { type: "choice", prompt: "", correct_choice: "0" }, { blockId: `qa|${id}|${r1}`, user: root }));
		const r2 = await rev();
		await measure("admin question_save", () => admin.submit("/quizzes", "question_save", { type: "true_false", prompt: "No?", correct_tf: "1" }, { blockId: `qe|${id}|${r2}|0`, user: root }));
		await measure("admin question_menu (remove asks first)", () => admin.act("/quizzes", "question_menu", { value: JSON.stringify({ a: "ask", q: id, i: 0 }), user: root }));
		const r3 = await rev();
		await measure("admin question_remove", () => admin.act("/quizzes", "question_remove", { value: { q: id, i: 0, r: r3 }, user: root }));
		const r4 = await rev();
		await measure("admin quiz_lessons (30 lessons)", () => admin.act("/quizzes", "quiz_lessons", { value: { q: id }, user: root }));
		await measure("admin quiz_lesson_set (claims a lesson, frees the old one)", async () => admin.act("/quizzes", "quiz_lesson_set", { value: { q: id, l: loose[20], r: await rev() }, user: root }));
		await measure("admin quiz_lesson_set (claims a lesson, frees the old one)", async () => admin.act("/quizzes", "quiz_lesson_set", { value: { q: id, l: loose[21], r: await rev() }, user: root }));
		await measure("admin quiz_lesson_set (lesson taken, refused)", async () => admin.act("/quizzes", "quiz_lesson_set", { value: { q: id, l: q20Lesson, r: await rev() }, user: root }));
		await measure("panel open_quiz", () => admin.actEditorPanel("courses", "lms_lessons", loose[21]!, "open_quiz", { value: { q: id }, user: root }));
		await measure("admin page_load /quizzes (opened from the lesson panel)", () => admin.loadPage("/quizzes", { user: root }));
		const r5 = await rev();
		await measure("admin quiz_delete", () => admin.act("/quizzes", "quiz_delete", { value: { q: id, r: r5 }, user: root }));
	});

	it("lists, erase and dashboard card", async () => {
		const admin = s.rt.admin;
		const page = await measure("admin page_load /enrollments (15 members)", () => admin.loadPage("/enrollments", { user: root }));
		expect(page.blocks.find((b: Out) => b.type === "table").rows.filter((r: Out) => /^Member /.test(r.member))).toHaveLength(14);
		await measure("admin enrollments_find (name, 520 members)", () => admin.submit("/enrollments", "enrollments_find", { find: "member 3" }, { user: root }));
		await measure("admin enrollments_find (email)", () => admin.submit("/enrollments", "enrollments_find", { find: "m3@example.com" }, { user: root }));
		// One member with 16 enrollments, so Find by name offers Next: page 2 runs Find again (five users
		// pages) plus the filtered count and page.
		const zed = (await s.rt.fixtures.user({ email: "zed@example.com", name: "Zed Pager", role: "subscriber" })).id;
		for (let i = 0; i < 16; i += 1) await s.rt.fixtures.plugin.storage("enrollments", `${zed}:z${i}`, { memberId: zed, courseKey: `z${i}`, courseTitle: "Course Z", startedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), updatedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), completedAt: null, done: [] });
		const found = (await admin.submit("/enrollments", "enrollments_find", { find: "zed pager" }, { user: root })) as Out;
		const findNext = found.blocks.find((b: Out) => b.type === "actions").elements.find((e: Out) => e.label === "Next page");
		expect((await measure("admin enrollments_page (Find by name, page 2)", () => admin.act("/enrollments", "enrollments_page", { value: findNext.value, user: root }))).blocks.find((b: Out) => b.type === "table").rows).toHaveLength(1);
		await measure("admin page_load /results (15 members)", () => admin.loadPage("/results", { user: root }));
		await measure("admin widget summary", () => admin.loadWidget("summary", { user: root }));
		await measure("admin member_menu (asks first)", () => admin.act("/enrollments", "member_menu", { value: JSON.stringify({ m: "ben", n: "Ben" }), user: root }));
		let done = false;
		for (let round = 0; round < 20 && !done; round += 1) {
			const out = await measure("admin member_erase (500 + 500 rows, each round)", () => admin.act("/enrollments", "member_erase", { value: { m: "ben", n: "Ben" }, user: root }));
			done = out.toast.type === "success";
		}
		expect(done).toBe(true);
		// The member route on a fresh 500 + 500.
		const at = new Date().toISOString();
		for (let i = 0; i < 500; i += 1) {
			await s.rt.fixtures.plugin.storage("enrollments", `ben:c${i}`, { memberId: "ben", courseKey: `c${i}`, courseTitle: "", startedAt: at, updatedAt: at, completedAt: null, done: [] });
			await s.rt.fixtures.plugin.storage("attempts", `ben:q${i}`, { memberId: "ben", quizId: `q${i}`, lessonKey: "", score: 0, total: 1, answers: [0], submittedAt: at });
		}
		done = false;
		for (let round = 0; round < 20 && !done; round += 1) {
			done = (await measure("route eraseMember (500 + 500 rows, each round)", () => s.post("eraseMember", {}, member("ben")))).done === true;
		}
		expect(done).toBe(true);
	}, 120_000);

	it("install, activate and the daily task", async () => {
		const hook = (name: string, event: unknown) => s.rt.transport.invokeHook(name, event);
		await measure("hook plugin:install", () => hook("plugin:install", {}));
		await measure("hook plugin:activate (marker set)", () => hook("plugin:activate", {}));
		await measure("hook cron daily (marker current)", () => hook("cron", { name: "daily" }));
		await s.rt.fixtures.plugin.kv("state:tasks", "0.0.1");
		await measure("hook cron daily (older marker)", () => hook("cron", { name: "daily" }));
	});

	it("MCP tool routes", async () => {
		const got = await measure("tool getOutline", () => tool("getOutline", { course }));
		const ids = got.lessons.map((l: { id: string }) => l.id).slice(0, 180);
		const out = await measure("tool setOutline (15 new lessons)", () => tool("setOutline", { course, lessons: [...ids, ...loose.slice(1, 16)], rev: got.rev }));
		expect(out.ok).toBe(true);
		await measure("tool listQuizzes", () => tool("listQuizzes", {}));
		await measure("tool saveQuiz (new, on a lesson)", () => tool("saveQuiz", { title: "Agent quiz", questions: QUIZ.questions, lesson: loose[25] }));
		const quiz = await measure("tool getQuiz", () => tool("getQuiz", { quiz: "q1" }));
		const saved = await measure("tool saveQuiz (replace)", () => tool("saveQuiz", { quiz: "q1", title: "Replaced", questions: QUIZ.questions, rev: quiz.rev }));
		await measure("tool deleteQuiz", () => tool("deleteQuiz", { quiz: "q1", rev: saved.quiz.rev }));
		await measure("tool listEnrollments", () => tool("listEnrollments", {}));
		await measure("tool listResults", () => tool("listResults", {}));
	});

	it("every entry point measured, none over the cap", () => {
		expect([...seen.keys()].sort()).toEqual(Object.keys(MEASURED).sort());
		for (const [name, n] of seen) expect(n, name).toBeLessThanOrEqual(CAP);
		console.log(Object.fromEntries(seen));
	});
});
