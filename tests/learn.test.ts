import { afterEach, describe, expect, it } from "vitest";

import { quiz as quizSchema } from "../src/schemas";
import { ana, ben, courseWithOutline, member, openSite, QUIZ, quizOnLesson, slugged, type Site } from "./site";

let site: Site | undefined;
afterEach(async () => {
	await site?.dispose();
	site = undefined;
});
const open = async () => (site = await openSite());

describe("outline", () => {
	it("answers a course's lessons in outline order, and none for a course without one", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 3);
		expect(await s.get("outline", { course })).toEqual({ ok: true, course, lessons: slugged(lessons) });
		expect(await s.get("outline", { course: "nope" })).toEqual({ ok: true, course: "nope", lessons: [] });
		expect((await s.get("outline", {})).error?.code).toBe("INVALID_INPUT");
	});
});

describe("public routes never reveal drafts", () => {
	it("outline answers nothing for a draft course", async () => {
		const s = await open();
		const draft = await s.entry("lms_courses", "Secret course", "draft");
		const lesson = await s.entry("lms_lessons", "Secret lesson");
		await s.rt.fixtures.plugin.storage("outlines", draft, { courseKey: draft, courseTitle: "Secret course", lessons: [{ id: lesson, title: "Secret lesson" }], updatedAt: "2026-11-15T00:00:00.000Z", rev: "r" });
		const out = await s.get("outline", { course: draft });
		expect(out.lessons).toEqual([]);
		expect(JSON.stringify(out)).not.toContain("Secret");
	});

	it("outline leaves out draft lessons and their titles", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 2);
		const hidden = await s.entry("lms_lessons", "Unfinished draft lesson", "draft");
		const row = await s.rt.inspect.storage.get<{ lessons: Array<{ id: string; title: string }> }>("outlines", course);
		await s.rt.fixtures.plugin.storage("outlines", course, { ...row, lessons: [lessons[0], { id: hidden, title: "Unfinished draft lesson" }, lessons[1]] });
		const out = await s.get("outline", { course });
		expect(out.lessons).toEqual(slugged(lessons));
		expect(JSON.stringify(out)).not.toContain("Unfinished");
	});

	it("quiz answers nothing for a draft lesson, and submitQuiz refuses it", async () => {
		const s = await open();
		const lesson = await quizOnLesson(s, "q1", "draft");
		const out = await s.get("memberQuiz", { lesson }, ana);
		expect(out.error?.code).toBe("QUIZ_NOT_FOUND");
		expect(JSON.stringify(out)).not.toContain("Pick C");
		expect(JSON.stringify(await s.get("quiz", { lesson }))).not.toContain("Pick C");
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).error?.code).toBe("QUIZ_NOT_FOUND");
	});
});

describe("member routes", () => {
	it("refuse a guest", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 1);
		for (const [name, input] of [
			["enroll", { course }],
			["completeLesson", { course, lesson: lessons[0]!.id }],
			["submitQuiz", { quiz: "q", answers: [0] }],
			["eraseMember", {}],
		] as const) {
			expect((await s.post(name, input)).error?.code, name).toBe("SIGN_IN_REQUIRED");
		}
		for (const [name, input] of [["progress", { course }], ["myCourses", {}]] as const) {
			expect((await s.get(name, input)).error?.code, name).toBe("SIGN_IN_REQUIRED");
		}
	});
});

describe("enroll", () => {
	it("enrolls once; a second enroll says already enrolled", async () => {
		const s = await open();
		const { course } = await courseWithOutline(s, 1);
		const first = await s.post("enroll", { course }, ana);
		expect(first).toMatchObject({ ok: true, enrollment: { memberId: "ana", courseKey: course, courseTitle: "Course A", completedAt: null, done: [] } });
		expect((await s.post("enroll", { course }, ana)).error?.code).toBe("ALREADY_ENROLLED");
		expect((await s.post("enroll", { course }, ben)).ok).toBe(true);
		expect(await s.rt.inspect.storage.list("enrollments")).toHaveLength(2);
	});

	it("refuses a draft or missing course", async () => {
		const s = await open();
		const draft = await s.entry("lms_courses", "Draft course", "draft");
		expect((await s.post("enroll", { course: draft }, ana)).error?.code).toBe("COURSE_NOT_FOUND");
		expect((await s.post("enroll", { course: "missing" }, ana)).error?.code).toBe("COURSE_NOT_FOUND");
	});
});

describe("kit reads: catalog, progress, myCourses", () => {
	it("catalog answers outline lesson counts only, 0 for a course without an outline, and refuses more than 24", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 3, "Course A");
		const out = await s.get("catalog", { courses: `${a.course},nope` });
		expect(out).toEqual({ ok: true, counts: { [a.course]: 3, nope: 0 } });
		expect(JSON.stringify(out)).not.toContain("lesson");
		const many = Array.from({ length: 25 }, (_, i) => `c${i}`).join(",");
		expect((await s.get("catalog", { courses: many })).error?.code).toBe("INVALID_INPUT");
	});

	it("catalog counts only published lessons and gives 0 for a course that is not published", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 2, "Course A");
		const hidden = await s.entry("lms_lessons", "Draft lesson", "draft");
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("outlines", a.course);
		await s.rt.fixtures.plugin.storage("outlines", a.course, { ...row, lessons: [...a.lessons, { id: hidden, title: "Draft lesson" }] });
		const draft = await s.entry("lms_courses", "Draft course", "draft");
		const lesson = await s.entry("lms_lessons", "Published lesson");
		await s.rt.fixtures.plugin.storage("outlines", draft, { courseKey: draft, courseTitle: "Draft course", lessons: [{ id: lesson, title: "Published lesson" }], updatedAt: "2026-11-15T00:00:00.000Z", rev: "r" });
		expect((await s.get("catalog", { courses: `${a.course},${draft}` })).counts).toEqual({ [a.course]: 2, [draft]: 0 });
	});

	it("lessonCourses lists the published courses holding a published lesson, Open first, and nothing for a draft lesson", async () => {
		const s = await open();
		const course = async (title: string, access: string, status = "published") =>
			(await s.rt.fixtures.content("lms_courses", { data: { title, access }, slug: title.toLowerCase().replaceAll(" ", "-"), status } as never)).id as string;
		const members = await course("Members course", "members");
		const openId = await course("Open course", "open");
		const draft = await course("Draft course", "open", "draft");
		const lesson = { id: await s.entry("lms_lessons", "Shared lesson"), title: "Shared lesson" };
		const hidden = { id: await s.entry("lms_lessons", "Draft lesson", "draft"), title: "Draft lesson" };
		for (const id of [members, openId, draft]) {
			await s.rt.fixtures.plugin.storage("outlines", id, { courseKey: id, courseTitle: "x", lessons: [lesson, hidden], updatedAt: "2026-11-15T00:00:00.000Z", rev: "r" });
		}
		const out = (await s.get("lessonCourses", { lesson: lesson.id })).courses as Array<Record<string, string>>;
		expect(out).toEqual([
			{ id: openId, slug: "open-course", title: "Open course", access: "open" },
			{ id: members, slug: "members-course", title: "Members course", access: "members" },
		]);
		expect(await s.get("lessonCourses", { lesson: hidden.id })).toEqual({ ok: true, courses: [] });
		expect(await s.get("lessonCourses", { lesson: "nope" })).toEqual({ ok: true, courses: [] });
	});

	it("progress answers the member's own enrollment or null; myCourses lists theirs with progress and the course slug", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 3, "Course A");
		const b = await courseWithOutline(s, 2, "Course B");
		expect(await s.get("progress", { course: a.course }, ana)).toEqual({ ok: true, enrollment: null });
		await s.post("enroll", { course: a.course }, ana);
		await s.post("enroll", { course: b.course }, ana);
		await s.post("enroll", { course: a.course }, ben);
		await s.post("completeLesson", { course: a.course, lesson: a.lessons[1]!.id }, ana);
		expect((await s.get("progress", { course: a.course }, ana)).enrollment).toMatchObject({ memberId: "ana", done: [a.lessons[1]!.id], courseSlug: "course-a" });
		const mine = (await s.get("myCourses", {}, ana)).items as Array<Record<string, unknown>>;
		expect(mine).toHaveLength(2);
		expect(mine[0]).toMatchObject({ course: a.course, slug: "course-a", title: "Course A", available: true, done: 1, total: 3, finished: false, completedAt: null });
		expect(mine[1]).toMatchObject({ course: b.course, slug: "course-b", done: 0, total: 2 });
		expect(((await s.get("myCourses", {}, member("cara"))).items as unknown[])).toEqual([]);
	});

	it("myCourses counts only done lessons still in the outline", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 2, "Course A");
		await s.post("enroll", { course: a.course }, ana);
		await s.post("completeLesson", { course: a.course, lesson: a.lessons[0]!.id }, ana);
		const row = await s.rt.inspect.storage.get<{ lessons: unknown[] }>("outlines", a.course);
		await s.rt.fixtures.plugin.storage("outlines", a.course, { ...row, lessons: [a.lessons[1]] });
		expect(((await s.get("myCourses", {}, ana)).items as unknown[])[0]).toMatchObject({ done: 0, total: 1 });
	});

	it("myCourses counts published lessons only, the same count as the course page (L2, M2)", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 2, "Course A");
		const draft = await s.entry("lms_lessons", "Draft lesson", "draft");
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("outlines", a.course);
		await s.rt.fixtures.plugin.storage("outlines", a.course, { ...row, lessons: [...a.lessons, { id: draft, title: "Draft lesson" }] });
		await s.post("enroll", { course: a.course }, ana);
		await s.post("completeLesson", { course: a.course, lesson: a.lessons[0]!.id }, ana);
		expect(((await s.get("myCourses", {}, ana)).items as unknown[])[0]).toMatchObject({ done: 1, total: 2, finished: false });
		await s.post("completeLesson", { course: a.course, lesson: a.lessons[1]!.id }, ana);
		expect(((await s.get("myCourses", {}, ana)).items as unknown[])[0]).toMatchObject({ done: 2, total: 2, finished: true });
	});

	it("myCourses labels a deleted or unpublished course instead of linking to it (L8)", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 1, "Course A");
		const b = await courseWithOutline(s, 1, "Course B");
		await s.post("enroll", { course: a.course }, ana);
		await s.post("enroll", { course: b.course }, ana);
		const c = await courseWithOutline(s, 1, "Course C");
		await s.post("enroll", { course: c.course }, ana);
		await s.rt.actions.content.trash("lms_courses", a.course);
		await s.rt.actions.content.unpublish("lms_courses", c.course);
		const items = (await s.get("myCourses", {}, ana)).items as Array<Record<string, unknown>>;
		expect(items.find((i) => i.course === b.course)).toMatchObject({ available: true, slug: "course-b" });
		for (const gone of [a.course, c.course]) expect(items.find((i) => i.course === gone)).toMatchObject({ available: false, slug: "" });
	});
});

describe("course structured data (page:metadata)", () => {
	const page = (course: string, slug: string | null = "course-a") => ({
		url: "https://site.test/courses/course-a",
		title: "Course A | Site",
		pageTitle: "Course A",
		description: "Learn A",
		canonical: "https://site.test/courses/course-a",
		image: null,
		siteName: "Site",
		content: { collection: "lms_courses", id: course, slug },
	});

	it("gives a published course a schema.org Course with its published lessons in hasPart, in order", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 2);
		const hidden = await s.entry("lms_lessons", "Draft lesson", "draft");
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("outlines", course);
		await s.rt.fixtures.plugin.storage("outlines", course, { ...row, lessons: [...lessons, { id: hidden, title: "Draft lesson" }] });
		const out = (await s.rt.transport.invokeHook("page:metadata", { page: page(course) })) as { kind: string; graph: Record<string, any> };
		expect(out.kind).toBe("jsonld");
		expect(out.graph).toMatchObject({ "@context": "https://schema.org", "@type": "Course", name: "Course A", description: "Learn A", provider: { "@type": "Organization", name: "Site" } });
		expect(out.graph.hasPart).toEqual([
			{ "@type": "LearningResource", position: 1, name: "Course A lesson 1", url: "https://site.test/lessons/course-a-lesson-1?course=course-a" },
			{ "@type": "LearningResource", position: 2, name: "Course A lesson 2", url: "https://site.test/lessons/course-a-lesson-2?course=course-a" },
		]);
		expect(JSON.stringify(out)).not.toContain("Draft lesson");
	});

	it("gives nothing for a draft course or a page that is not a course", async () => {
		const s = await open();
		const draft = await s.entry("lms_courses", "Draft course", "draft");
		expect(await s.rt.transport.invokeHook("page:metadata", { page: page(draft) })).toBeNull();
		expect(await s.rt.transport.invokeHook("page:metadata", { page: { ...page(draft), content: { collection: "posts", id: "x", slug: "x" } } })).toBeNull();
		expect(await s.rt.transport.invokeHook("page:metadata", { page: { ...page(draft), content: undefined } })).toBeNull();
	});
});

describe("completeLesson", () => {
	it("refuses a member who is not enrolled", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 2);
		expect((await s.post("completeLesson", { course, lesson: lessons[0]!.id }, ana)).error?.code).toBe("NOT_ENROLLED");
	});

	it("refuses a lesson that is not in the course outline, even one in another course", async () => {
		const s = await open();
		const a = await courseWithOutline(s, 2, "Course A");
		const b = await courseWithOutline(s, 1, "Course B");
		const loose = await s.entry("lms_lessons", "Loose lesson");
		await s.post("enroll", { course: a.course }, ana);
		for (const lesson of [loose, b.lessons[0]!.id]) {
			expect((await s.post("completeLesson", { course: a.course, lesson }, ana)).error?.code).toBe("LESSON_NOT_IN_COURSE");
		}
	});

	it("counts the outline: completedAt is set only when every outline lesson is done, in any order", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 3);
		await s.post("enroll", { course }, ana);
		const ids = lessons.map((l) => l.id);
		let out = await s.post("completeLesson", { course, lesson: ids[2] }, ana);
		expect(out).toMatchObject({ ok: true, enrollment: { done: [ids[2]], completedAt: null } });
		out = await s.post("completeLesson", { course, lesson: ids[0] }, ana);
		expect(out).toMatchObject({ enrollment: { completedAt: null } });
		// Marking a lesson twice changes nothing.
		out = await s.post("completeLesson", { course, lesson: ids[0] }, ana);
		expect((out.enrollment as { done: string[] }).done).toEqual([ids[2], ids[0]]);
		out = await s.post("completeLesson", { course, lesson: ids[1] }, ana);
		expect((out.enrollment as { completedAt: string | null }).completedAt).toEqual(expect.any(String));
		const row = await s.rt.inspect.storage.get<{ done: string[]; completedAt: string }>("enrollments", `ana:${course}`);
		expect(row?.done).toHaveLength(3);
		expect(row?.completedAt).toBeTruthy();
	});

	it("finishes on the published lessons: a draft or deleted lesson in the outline does not hold the course open (M2)", async () => {
		const s = await open();
		const { course, lessons } = await courseWithOutline(s, 2);
		const draft = await s.entry("lms_lessons", "Draft lesson", "draft");
		const row = await s.rt.inspect.storage.get<Record<string, unknown>>("outlines", course);
		await s.rt.fixtures.plugin.storage("outlines", course, { ...row, lessons: [...lessons, { id: draft, title: "Draft lesson" }, { id: "deleted-lesson", title: "Gone" }] });
		await s.post("enroll", { course }, ana);
		expect((await s.post("completeLesson", { course, lesson: lessons[0]!.id }, ana)).enrollment).toMatchObject({ completedAt: null });
		const out = await s.post("completeLesson", { course, lesson: lessons[1]!.id }, ana);
		expect((out.enrollment as { completedAt: string | null }).completedAt).toEqual(expect.any(String));
	});
});

describe("quiz", () => {
	it("never sends the correct answers", async () => {
		const s = await open();
		const lesson = await quizOnLesson(s);
		const out = await s.get("memberQuiz", { lesson }, ana);
		expect(out).toEqual({
			ok: true,
			quiz: {
				id: "q1",
				title: "Check yourself",
				lessonKey: lesson,
				questions: [
					{ type: "choice", prompt: "Pick C", answers: ["A", "B", "C", "D"] },
					{ type: "true_false", prompt: "The sky is blue" },
				],
			},
		});
		expect(JSON.stringify(out)).not.toContain("correct");
		expect((await s.get("memberQuiz", { lesson: "none" }, ana)).error?.code).toBe("QUIZ_NOT_FOUND");
		expect((await s.get("memberQuiz", { lesson })).error?.code).toBe("SIGN_IN_REQUIRED");
	});

	it("is public only for a lesson in a published Open course; a guest gets sign-in for any other lesson (#9)", async () => {
		const s = await open();
		const lesson = await quizOnLesson(s);
		const course = async (title: string, access: string, status = "published") =>
			(await s.rt.fixtures.content("lms_courses", { data: { title, access }, slug: title.toLowerCase().replaceAll(" ", "-"), status } as never)).id as string;
		const put = (id: string) => s.rt.fixtures.plugin.storage("outlines", id, { courseKey: id, courseTitle: "x", lessons: [{ id: lesson, title: "L" }], updatedAt: "2026-11-15T00:00:00.000Z", rev: "r" });
		// In no course, in a Members course, in a draft Open course: the guest learns nothing about the questions.
		for (const holder of [null, await course("Members course", "members"), await course("Draft open course", "open", "draft")]) {
			if (holder) await put(holder);
			const out = await s.get("quiz", { lesson });
			expect(out.error?.code).toBe("SIGN_IN_REQUIRED");
			expect(JSON.stringify(out)).not.toContain("Pick C");
		}
		await put(await course("Open course", "open"));
		expect(((await s.get("quiz", { lesson })).quiz as { questions: unknown[] }).questions).toHaveLength(2);
	});

	it("refuses a question type other than choice and true_false, and more than 20 questions", async () => {
		const s = await open();
		const essay = { ...QUIZ, questions: [{ type: "essay", prompt: "Write", correct: 0 }] };
		const lesson = await quizOnLesson(s, "bad", "published", essay);
		expect((await s.get("memberQuiz", { lesson }, ana)).error?.code).toBe("QUIZ_INVALID");
		expect((await s.post("submitQuiz", { quiz: "bad", answers: [0] }, ana)).error?.code).toBe("QUIZ_INVALID");
		expect(quizSchema.safeParse(essay).success).toBe(false);
		const many = { ...QUIZ, questions: Array.from({ length: 21 }, () => QUIZ.questions[1]) };
		expect(quizSchema.safeParse(many).success).toBe(false);
		expect(quizSchema.safeParse({ ...QUIZ, questions: Array.from({ length: 20 }, () => QUIZ.questions[1]) }).success).toBe(true);
	});
});

describe("submitQuiz", () => {
	it("scores on the server and replaces the member's attempt", async () => {
		const s = await open();
		await quizOnLesson(s);
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [1, 0] }, ana)).toEqual({ ok: true, score: 1, total: 2, right: [false, true] });
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).toEqual({ ok: true, score: 2, total: 2, right: [true, true] });
		const attempts = await s.rt.inspect.storage.list<{ score: number }>("attempts");
		expect(attempts).toHaveLength(1);
		expect(attempts[0]).toMatchObject({ id: "ana:q1", data: { score: 2, answers: [2, 0] } });
	});

	it("refuses missing answers and an out-of-range true/false answer", async () => {
		const s = await open();
		await quizOnLesson(s);
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2] }, ana)).error?.code).toBe("ANSWER_EVERY_QUESTION");
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [2, 3] }, ana)).error?.code).toBe("ANSWER_EVERY_QUESTION");
		expect((await s.post("submitQuiz", { quiz: "q1", answers: [9, 0] }, ana)).error?.code).toBe("INVALID_INPUT");
		expect(await s.rt.inspect.storage.list("attempts")).toHaveLength(0);
	});
});

describe("eraseMember", () => {
	it("removes every enrollment and attempt of the member, in batches, and leaves others alone", async () => {
		const s = await open();
		const put = s.rt.fixtures.plugin.storage;
		const at = "2026-11-15T00:00:00.000Z";
		for (let i = 0; i < 500; i += 1) {
			await put("enrollments", `ana:c${i}`, { memberId: "ana", courseKey: `c${i}`, courseTitle: "", startedAt: at, updatedAt: at, completedAt: null, done: [] });
			await put("attempts", `ana:q${i}`, { memberId: "ana", quizId: `q${i}`, lessonKey: "", score: 0, total: 1, answers: [0], submittedAt: at });
		}
		await put("enrollments", "ben:c0", { memberId: "ben", courseKey: "c0", courseTitle: "", startedAt: at, updatedAt: at, completedAt: null, done: [] });
		await put("attempts", "ben:q0", { memberId: "ben", quizId: "q0", lessonKey: "", score: 0, total: 1, answers: [0], submittedAt: at });
		let out = await s.post("eraseMember", {}, ana);
		let rounds = 1;
		while (out.done === false) {
			out = await s.post("eraseMember", {}, ana);
			rounds += 1;
		}
		expect(rounds).toBeGreaterThan(1);
		const left = [...(await s.rt.inspect.storage.list("enrollments")), ...(await s.rt.inspect.storage.list("attempts"))].map((row) => row.id);
		expect(left.sort()).toEqual(["ben:c0", "ben:q0"]);
	});
});
