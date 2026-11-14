import { afterEach, describe, expect, it } from "vitest";

import { quiz as quizSchema } from "../src/schemas";
import { ana, ben, courseWithOutline, openSite, QUIZ, type Site } from "./site";

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
		expect(await s.get("outline", { course })).toEqual({ ok: true, course, lessons });
		expect(await s.get("outline", { course: "nope" })).toEqual({ ok: true, course: "nope", lessons: [] });
		expect((await s.get("outline", {})).error?.code).toBe("INVALID_INPUT");
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
});

describe("quiz", () => {
	it("never sends the correct answers", async () => {
		const s = await open();
		await s.rt.fixtures.plugin.storage("quizzes", "q1", QUIZ);
		const out = await s.get("quiz", { quiz: "q1" });
		expect(out).toEqual({
			ok: true,
			quiz: {
				id: "q1",
				title: "Check yourself",
				lessonKey: "lesson-1",
				questions: [
					{ type: "choice", prompt: "Pick C", answers: ["A", "B", "C", "D"] },
					{ type: "true_false", prompt: "The sky is blue" },
				],
			},
		});
		expect(JSON.stringify(out)).not.toContain("correct");
		expect((await s.get("quiz", { quiz: "none" })).error?.code).toBe("QUIZ_NOT_FOUND");
	});

	it("refuses a question type other than choice and true_false, and more than 20 questions", async () => {
		const s = await open();
		const essay = { ...QUIZ, questions: [{ type: "essay", prompt: "Write", correct: 0 }] };
		await s.rt.fixtures.plugin.storage("quizzes", "bad", essay);
		expect((await s.get("quiz", { quiz: "bad" })).error?.code).toBe("QUIZ_INVALID");
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
		await s.rt.fixtures.plugin.storage("quizzes", "q1", QUIZ);
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [1, 0] }, ana)).toEqual({ ok: true, score: 1, total: 2, right: [false, true] });
		expect(await s.post("submitQuiz", { quiz: "q1", answers: [2, 0] }, ana)).toEqual({ ok: true, score: 2, total: 2, right: [true, true] });
		const attempts = await s.rt.inspect.storage.list<{ score: number }>("attempts");
		expect(attempts).toHaveLength(1);
		expect(attempts[0]).toMatchObject({ id: "ana:q1", data: { score: 2, answers: [2, 0] } });
	});

	it("refuses missing answers and an out-of-range true/false answer", async () => {
		const s = await open();
		await s.rt.fixtures.plugin.storage("quizzes", "q1", QUIZ);
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
