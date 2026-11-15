import { afterEach, describe, expect, it } from "vitest";

import { courseWithOutline, member, openSite, QUIZ, type Site } from "./site";

let site: Site | undefined;
afterEach(async () => {
	await site?.dispose();
	site = undefined;
});

const root = member("root", 50);
type R = { blocks: Array<Record<string, any>>; toast?: { type: string; message: string }; navigate?: unknown };

/** Every visible text of a response, element values (never shown) left out. */
function visible(response: R): string {
	const out: string[] = [];
	const walk = (node: unknown, key = ""): void => {
		if (key === "value" || key === "block_id" || key === "action_id" || key === "target") return;
		if (typeof node === "string") out.push(node);
		else if (Array.isArray(node)) node.forEach((n) => walk(n));
		else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, k);
	};
	walk(response.blocks);
	return out.join(" | ");
}
const table = (r: R) => r.blocks.find((b) => b.type === "table");
const cellButton = (r: R, rowIndex: number, key: string) => table(r)!.rows[rowIndex][key] as { action_id: string; value: unknown };
/** The value a row's Change menu sends for the item with this label. */
const menuPick = (r: R, rowIndex: number, label: string) => (table(r)!.rows[rowIndex].change.items as Array<{ label: string; value: string }>).find((i) => i.label === label)!.value;

describe("Course outline page", () => {
	it("picks a course, adds lessons by title, reorders and removes them; never shows an id", async () => {
		const s = (site = await openSite());
		const course = await s.entry("lms_courses", "Bread Basics");
		const ids = [await s.entry("lms_lessons", "Knead"), await s.entry("lms_lessons", "Proof"), await s.entry("lms_lessons", "Bake", "draft")];
		const admin = s.rt.admin;
		let page = (await admin.loadPage("/outline", { user: root })) as R;
		expect(table(page)!.rows[0]).toMatchObject({ course: "Bread Basics", lessons: 0 });
		page = (await admin.act("/outline", "outline_open", { value: cellButton(page, 0, "open").value, user: root })) as R;
		expect(visible(page)).toContain("No lessons in this outline yet");
		page = (await admin.act("/outline", "outline_add", { value: { c: course }, user: root })) as R;
		// Lessons by title (Bake, Knead, Proof), then add each one.
		for (const title of ["Proof", "Knead", "Bake"]) {
			const at = table(page)!.rows.findIndex((r: { lesson: string }) => r.lesson === title);
			page = (await admin.act("/outline", "outline_put", { value: cellButton(page, at, "add").value, user: root })) as R;
			expect(page.toast).toMatchObject({ type: "success", message: `Added "${title}".` });
		}
		page = (await admin.act("/outline", "outline_open", { value: { c: course }, user: root })) as R;
		expect(table(page)!.rows.map((r: { lesson: string }) => r.lesson)).toEqual(["Proof", "Knead", "Bake"]);
		expect(table(page)!.rows[2].status).toBe("Draft");
		expect(visible(page)).toContain("1 lesson on this page is not published");
		expect(table(page)!.rows[0].change.items.map((i: { label: string }) => i.label)).toEqual(["Move down", "Remove from course"]);
		page = (await admin.act("/outline", "outline_menu", { value: menuPick(page, 1, "Move up"), user: root })) as R;
		expect(table(page)!.rows.map((r: { lesson: string }) => r.lesson)).toEqual(["Knead", "Proof", "Bake"]);
		page = (await admin.act("/outline", "outline_menu", { value: menuPick(page, 2, "Remove from course"), user: root })) as R;
		expect(table(page)!.rows.map((r: { lesson: string }) => r.lesson)).toEqual(["Knead", "Proof"]);
		const stored = await s.rt.inspect.storage.get<{ lessons: Array<{ id: string }> }>("outlines", course);
		expect(stored!.lessons.map((l) => l.id)).toEqual([ids[0], ids[1]]);
		for (const id of [course, ...ids]) expect(visible(page)).not.toContain(id);
		// The public outline route follows the saved order.
		expect((await s.get("outline", { course })).lessons).toEqual([{ id: ids[0], title: "Knead", slug: "knead" }, { id: ids[1], title: "Proof", slug: "proof" }]);
	});

	it("refuses a save from a second tab with an old version token", async () => {
		const s = (site = await openSite());
		const { course } = await courseWithOutline(s, 3);
		const tab1 = (await s.rt.admin.act("/outline", "outline_open", { value: { c: course }, user: root })) as R;
		const tab2 = (await s.rt.admin.act("/outline", "outline_open", { value: { c: course }, user: root })) as R;
		await s.rt.admin.act("/outline", "outline_menu", { value: menuPick(tab1, 0, "Move down"), user: root });
		const refused = (await s.rt.admin.act("/outline", "outline_menu", { value: menuPick(tab2, 0, "Remove from course"), user: root })) as R;
		expect(refused.toast).toMatchObject({ type: "error" });
		expect(refused.toast!.message).toContain("Someone else changed this outline");
		expect((await s.get("outline", { course })).lessons).toHaveLength(3);
	});
});

describe("Quizzes page", () => {
	it("creates a quiz, adds a choice and a true/false question, edits one, refuses the 21st", async () => {
		const s = (site = await openSite());
		const admin = s.rt.admin;
		let page = (await admin.loadPage("/quizzes", { user: root })) as R;
		expect(visible(page)).toContain("No quizzes yet");
		expect(visible(page)).toContain("Create quiz");
		expect((await admin.submit("/quizzes", "quiz_create", { title: "" }, { user: root })).toast).toMatchObject({ type: "error" });
		page = (await admin.submit("/quizzes", "quiz_create", { title: "Bread check" }, { user: root })) as R;
		const form = () => page.blocks.find((b) => b.type === "form" && String(b.block_id).startsWith("q") && b.submit.action_id.startsWith("question"))!;
		page = (await admin.submit("/quizzes", "question_add", { type: "choice", prompt: "Which rises?", answer_0: "Dough", answer_1: "Stone", answer_2: "Glass", answer_3: "", correct_choice: "0" }, { blockId: form().block_id, user: root })) as R;
		expect(page.toast).toEqual({ type: "error", message: "Fill in all four answers." });
		page = (await admin.submit("/quizzes", "question_add", { type: "choice", prompt: "Which rises?", answer_0: "Dough", answer_1: "Stone", answer_2: "Glass", answer_3: "Sand", correct_choice: "0" }, { blockId: form().block_id, user: root })) as R;
		page = (await admin.submit("/quizzes", "question_add", { type: "true_false", prompt: "Salt slows yeast", correct_tf: "0" }, { blockId: form().block_id, user: root })) as R;
		expect(table(page)!.rows.map((r: { question: string; answer: string }) => [r.question, r.answer])).toEqual([["Which rises?", "Dough"], ["Salt slows yeast", "True"]]);
		page = (await admin.act("/quizzes", "question_menu", { value: (table(page)!.rows[1].change.items as Array<{ label: string; value: string }>).find((i) => i.label === "Edit question")!.value, user: root })) as R;
		page = (await admin.submit("/quizzes", "question_save", { type: "true_false", prompt: "Salt slows yeast", correct_tf: "1" }, { blockId: form().block_id, user: root })) as R;
		expect(table(page)!.rows[1].answer).toBe("False");
		const [quiz] = await s.rt.inspect.storage.list<{ questions: unknown[] }>("quizzes");
		expect(quiz!.data.questions).toHaveLength(2);
		// Fill to 20, then a 21st is refused in plain words.
		await s.rt.fixtures.plugin.storage("quizzes", quiz!.id, { ...quiz!.data, questions: Array.from({ length: 20 }, () => QUIZ.questions[1]), rev: "full" });
		page = (await admin.act("/quizzes", "quiz_open", { value: { q: quiz!.id }, user: root })) as R;
		expect(visible(page)).toContain("This quiz has 20 questions");
		const refused = (await admin.submit("/quizzes", "question_add", { type: "true_false", prompt: "One more", correct_tf: "0" }, { blockId: `qa|${quiz!.id}|full`, user: root })) as R;
		expect(refused.toast).toEqual({ type: "error", message: "A quiz holds at most 20 questions." });
	});

	it("refuses a second tab's save and a stale delete, and deletes with the current token", async () => {
		const s = (site = await openSite());
		await s.rt.fixtures.plugin.storage("quizzes", "q1", QUIZ);
		const admin = s.rt.admin;
		await admin.submit("/quizzes", "quiz_title", { title: "Renamed in tab 1" }, { blockId: "qt|q1|q1", user: root });
		const second = (await admin.submit("/quizzes", "quiz_title", { title: "Renamed in tab 2" }, { blockId: "qt|q1|q1", user: root })) as R;
		expect(second.toast!.message).toContain("Someone else changed this quiz");
		expect((await admin.act("/quizzes", "quiz_delete", { value: { q: "q1", r: "q1" }, user: root })).toast).toMatchObject({ type: "error" });
		const list = (await admin.loadPage("/quizzes", { user: root })) as R;
		expect(table(list)!.rows[0].quiz).toBe("Renamed in tab 1");
		const quizPage = (await admin.act("/quizzes", "quiz_open", { value: cellButton(list, 0, "open").value, user: root })) as R;
		// Removing a question asks once on the page, naming it.
		const asked = (await admin.act("/quizzes", "question_menu", { value: JSON.stringify({ a: "ask", q: "q1", i: 0 }), user: root })) as R;
		expect(visible(asked)).toContain('Remove question 1?');
		const del = quizPage.blocks.flatMap((b) => (b.type === "actions" ? b.elements : [])).find((e: { label: string }) => e.label === "Delete quiz");
		const done = (await admin.act("/quizzes", "quiz_delete", { value: del.value, user: root })) as R;
		expect(done.toast).toEqual({ type: "success", message: 'Deleted "Renamed in tab 1".' });
		expect(await s.rt.inspect.storage.list("quizzes")).toHaveLength(0);
	});
});

describe("A quiz picks its lesson", () => {
	it("picks a lesson by title, refuses a second quiz on it, and the lesson panel shows and opens the quiz", async () => {
		const s = (site = await openSite());
		const lesson = await s.entry("lms_lessons", "Kneading");
		const admin = s.rt.admin;
		const make = async (title: string) => {
			const page = (await admin.submit("/quizzes", "quiz_create", { title }, { user: root })) as R;
			const id = (await s.rt.inspect.storage.list<{ title: string }>("quizzes")).find((q) => q.data.title === title)!.id;
			return { page, id };
		};
		const first = await make("First quiz");
		expect(visible(first.page)).toContain("Not on a lesson yet");
		let pick = (await admin.act("/quizzes", "quiz_lessons", { value: { q: first.id }, user: root })) as R;
		const row = table(pick)!.rows.find((r: { lesson: string }) => r.lesson === "Kneading");
		let page = (await admin.act("/quizzes", "quiz_lesson_set", { value: row.pick.value, user: root })) as R;
		expect(page.toast).toMatchObject({ type: "success" });
		expect(visible(page)).toContain('On the lesson "Kneading"');
		// A second quiz cannot take the same lesson: the list says which quiz has it, and a forced save is refused.
		const second = await make("Second quiz");
		pick = (await admin.act("/quizzes", "quiz_lessons", { value: { q: second.id }, user: root })) as R;
		const taken = table(pick)!.rows.find((r: { lesson: string }) => r.lesson === "Kneading");
		expect(taken).toMatchObject({ quiz: "First quiz", pick: null });
		const rev = (await s.rt.inspect.storage.get<{ rev: string }>("quizzes", second.id))!.rev;
		page = (await admin.act("/quizzes", "quiz_lesson_set", { value: { q: second.id, l: lesson, r: rev }, user: root })) as R;
		expect(page.toast!.message).toContain('That lesson already has the quiz "First quiz"');
		// The public route finds the quiz by its lesson; the panel shows it and opens it.
		// Found by its lesson: a quiz without questions yet answers QUIZ_EMPTY, a lesson without one QUIZ_NOT_FOUND.
		expect((await s.get("quiz", { lesson })).error?.code).toBe("QUIZ_EMPTY");
		const panel = (await admin.loadEditorPanel("courses", "lms_lessons", lesson, { user: root })) as R;
		expect(visible(panel)).toContain("Quiz: First quiz");
		const go = (await admin.actEditorPanel("courses", "lms_lessons", lesson, "open_quiz", { value: { q: first.id }, user: root })) as R;
		expect(go.navigate).toEqual({ kind: "plugin-page", path: "/quizzes" });
		expect(visible((await admin.loadPage("/quizzes", { user: root })) as R)).toContain("Quiz: First quiz");
		// Taking it off frees the lesson for the second quiz; deleting a quiz frees its lesson too.
		const r1 = (await s.rt.inspect.storage.get<{ rev: string }>("quizzes", first.id))!.rev;
		await admin.act("/quizzes", "quiz_lesson_set", { value: { q: first.id, l: "", r: r1 }, user: root });
		page = (await admin.act("/quizzes", "quiz_lesson_set", { value: { q: second.id, l: lesson, r: rev }, user: root })) as R;
		expect(page.toast).toMatchObject({ type: "success" });
		const r2 = (await s.rt.inspect.storage.get<{ rev: string }>("quizzes", second.id))!.rev;
		await admin.act("/quizzes", "quiz_delete", { value: { q: second.id, r: r2 }, user: root });
		const r3 = (await s.rt.inspect.storage.get<{ rev: string }>("quizzes", first.id))!.rev;
		expect((await admin.act("/quizzes", "quiz_lesson_set", { value: { q: first.id, l: lesson, r: r3 }, user: root })).toast).toMatchObject({ type: "success" });
		expect(visible(panel)).not.toContain(lesson);
	});

	it("two saves putting different quizzes on one lesson at the same moment: exactly one wins", async () => {
		const s = (site = await openSite());
		const lesson = await s.entry("lms_lessons", "Contested");
		const call = (input: unknown) => s.rt.transport.invokeRoute("tools/saveQuiz", input, { method: "POST", user: root } as never) as Promise<Record<string, any>>;
		const results = await Promise.all([1, 2, 3, 4].map((n) => call({ title: `Racer ${n}`, questions: QUIZ.questions, lesson })));
		expect(results.filter((r) => r.ok)).toHaveLength(1);
		expect(results.filter((r) => r.error?.code === "LESSON_HAS_QUIZ")).toHaveLength(3);
		const onLesson = (await s.rt.inspect.storage.list<{ lessonKey: string }>("quizzes")).filter((q) => q.data.lessonKey === lesson);
		expect(onLesson).toHaveLength(1);
		expect(onLesson[0]!.id).toBe(results.find((r) => r.ok)!.id);
		expect((await call({ title: "Lost lesson", questions: [], lesson: "missing" })).error.code).toBe("LESSON_NOT_FOUND");
	});
});

describe("Enrollments and Quiz results", () => {
	it("show names, find by name and email, page 15 at a time, and erase one member", async () => {
		const s = (site = await openSite());
		const ana = await s.rt.fixtures.user({ email: "ana@example.com", name: "Ana Lopez", role: "subscriber" });
		const ben = await s.rt.fixtures.user({ email: "ben@example.com", name: "Ben Ito", role: "subscriber" });
		const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString();
		for (let i = 0; i < 20; i += 1) {
			const who = i < 18 ? ana.id : ben.id;
			await s.rt.fixtures.plugin.storage("enrollments", `${who}:c${i}`, { memberId: who, courseKey: `c${i}`, courseTitle: `Course ${i}`, startedAt: at(i), updatedAt: at(i), completedAt: null, done: [] });
		}
		await s.rt.fixtures.plugin.storage("quizzes", "q1", QUIZ);
		await s.rt.fixtures.plugin.storage("attempts", `${ana.id}:q1`, { memberId: ana.id, quizId: "q1", lessonKey: "", score: 1, total: 2, answers: [2, 1], submittedAt: at(1) });
		const admin = s.rt.admin;
		let page = (await admin.loadPage("/enrollments", { user: root })) as R;
		expect(table(page)!.rows).toHaveLength(15);
		expect(table(page)!.rows[0]).toMatchObject({ member: "Ben Ito", course: "Course 19", progress: "0 of 0 lessons" });
		expect(visible(page)).not.toContain(ana.id);
		const next = page.blocks.find((b) => b.type === "actions")!.elements.find((e: { label: string }) => e.label === "Next page");
		page = (await admin.act("/enrollments", "enrollments_page", { value: next.value, user: root })) as R;
		expect(table(page)!.rows).toHaveLength(5);
		page = (await admin.submit("/enrollments", "enrollments_find", { find: "ito" }, { user: root })) as R;
		expect(table(page)!.rows.map((r: { member: string }) => r.member)).toEqual(["Ben Ito", "Ben Ito"]);
		page = (await admin.submit("/enrollments", "enrollments_find", { find: "ana@example.com" }, { user: root })) as R;
		expect(table(page)!.rows).toHaveLength(15);
		const results = (await admin.loadPage("/results", { user: root })) as R;
		expect(table(results)!.rows[0]).toMatchObject({ member: "Ana Lopez", quiz: "Check yourself", score: "1 of 2" });
		const anaRow = table(page)!.rows[0];
		const ask = (await admin.act("/enrollments", "member_menu", { value: anaRow.erase.items[0].value, user: root })) as R;
		expect(visible(ask)).toContain("Erase Ana Lopez's Learnomy data?");
		const confirm = ask.blocks.find((b) => b.type === "actions")!.elements[0];
		const erased = (await admin.act("/enrollments", "member_erase", { value: confirm.value, user: root })) as R;
		expect(erased.toast).toEqual({ type: "success", message: "Erased Ana Lopez's enrollments and quiz results." });
		expect((await s.rt.inspect.storage.list("enrollments")).map((r) => r.id).every((id) => id.startsWith(ben.id))).toBe(true);
		expect(await s.rt.inspect.storage.list("attempts")).toHaveLength(0);
		expect(visible((await admin.loadPage("/results", { user: root })) as R)).toContain("No quiz results yet");
	});
});

describe("Lesson panel and dashboard card", () => {
	it("lists the courses a lesson is in and opens that course's outline", async () => {
		const s = (site = await openSite());
		const a = await courseWithOutline(s, 2, "Course A");
		const loose = await s.entry("lms_lessons", "Loose");
		const panel = (await s.rt.admin.loadEditorPanel("courses", "lms_lessons", a.lessons[0]!.id, { user: root })) as R;
		expect(visible(panel)).toContain("This lesson is in one course");
		expect(visible(panel)).toContain("Course A");
		expect(visible((await s.rt.admin.loadEditorPanel("courses", "lms_lessons", loose, { user: root })) as R)).toContain("not in a course yet");
		const go = (await s.rt.admin.actEditorPanel("courses", "lms_lessons", a.lessons[0]!.id, "open_outline", { value: { c: a.course }, user: root })) as R;
		expect(go.navigate).toEqual({ kind: "plugin-page", path: "/outline" });
		const opened = (await s.rt.admin.loadPage("/outline", { user: root })) as R;
		expect(visible(opened)).toContain("Outline: Course A");
		// Only once: the next visit shows every course again.
		expect(visible((await s.rt.admin.loadPage("/outline", { user: root })) as R)).toContain("Pick a course");
	});

	it("dashboard card counts and links New course and Course outline", async () => {
		const s = (site = await openSite());
		await courseWithOutline(s, 1);
		await s.post("enroll", { course: (await s.rt.inspect.storage.list("outlines"))[0]!.id }, member("ana"));
		const card = (await s.rt.admin.loadWidget("summary", { user: root })) as R;
		expect(card.blocks[0]!.fields.map((i: { label: string; value: unknown }) => [i.label, i.value])).toEqual([["Published courses", "1"], ["Enrollments", "1"], ["Quiz results", "0"]]);
		expect(card.blocks[1]!.elements.map((e: { label: string }) => e.label)).toEqual(["New course", "Course outline"]);
	});
});

describe("MCP tools", () => {
	it("declares the eight tools on private routes with explicit permissions; deletes and overwrites are destructive", async () => {
		const s = (site = await openSite());
		const manifest = s.rt.manifest as unknown as { mcp: { tools: Array<{ name: string; route: string; destructive?: boolean }> }; routes: Array<{ name: string; public?: boolean; permission?: string }> };
		const tools = Object.fromEntries(manifest.mcp.tools.map((t) => [t.name, t]));
		expect(Object.keys(tools).sort()).toEqual(["deleteQuiz", "getOutline", "getQuiz", "listEnrollments", "listQuizzes", "listResults", "saveQuiz", "setOutline"]);
		for (const name of ["deleteQuiz", "saveQuiz", "setOutline"]) expect(tools[name]!.destructive, name).toBe(true);
		for (const tool of Object.values(tools)) {
			const route = manifest.routes.find((r) => r.name === tool.route)!;
			expect(route.public ?? false).toBe(false);
			expect(route.permission).toBe("plugins:manage");
		}
	});

	it("setOutline and saveQuiz write through the same paths as the admin pages", async () => {
		const s = (site = await openSite());
		const course = await s.entry("lms_courses", "Agent course");
		const l1 = await s.entry("lms_lessons", "One");
		const l2 = await s.entry("lms_lessons", "Two");
		const call = (name: string, input: unknown) => s.rt.transport.invokeRoute(`tools/${name}`, input, { method: "POST", user: root } as never) as Promise<Record<string, any>>;
		expect((await call("setOutline", { course, lessons: [l2, l1] })).ok).toBe(true);
		const got = await call("getOutline", { course });
		expect(got.lessons.map((l: { title: string }) => l.title)).toEqual(["Two", "One"]);
		expect((await call("setOutline", { course, lessons: [l1], rev: "old" })).error.code).toBe("STALE");
		expect((await call("setOutline", { course, lessons: [l1, "nope"], rev: got.rev })).error.code).toBe("LESSON_NOT_FOUND");
		const made = await call("saveQuiz", { title: "Agent quiz", questions: QUIZ.questions });
		expect(made.ok).toBe(true);
		expect((await call("saveQuiz", { quiz: made.id, title: "x", questions: [{ type: "essay", prompt: "p", correct: 0 }] })).error.code).toBe("INVALID_INPUT");
		expect((await call("getQuiz", { quiz: made.id })).questions[0].correct).toBe(2);
		expect((await call("listQuizzes", {})).items[0]).toMatchObject({ title: "Agent quiz", questions: 2 });
		expect((await call("deleteQuiz", { quiz: made.id, rev: made.quiz.rev })).ok).toBe(true);
	});
});
