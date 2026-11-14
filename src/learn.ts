import type { PluginContext } from "emdash/plugin";
import type { z } from "zod/mini";

import {
	courseInput,
	lessonInput,
	MAX_DONE,
	outline as outlineSchema,
	quiz as quizSchema,
	quizInput,
	submitInput,
	type Attempt,
	type Enrollment,
	type Outline,
	type Quiz,
} from "./schemas";
import { asRecord, asString, nowIso } from "./util";

type Ctx = PluginContext;
type RouteCtx = { input: unknown; user?: { id: string } };
type Fail = { ok: false; error: { code: string; message: string } };

const fail = (code: string, message: string): Fail => ({ ok: false, error: { code, message } });
const SIGN_IN = fail("SIGN_IN_REQUIRED", "Sign in to continue.");
const BAD_INPUT = fail("INVALID_INPUT", "Something in the request is missing or not valid.");

function parse<S extends z.ZodMiniType>(schema: S, input: unknown): z.infer<S> | null {
	const parsed = schema.safeParse(input);
	return parsed.success ? parsed.data : null;
}

const enrollmentId = (memberId: string, courseKey: string) => `${memberId}:${courseKey}`;

async function loadOutline(ctx: Ctx, courseKey: string): Promise<Outline | null> {
	return parse(outlineSchema, await ctx.storage.outlines!.get(courseKey));
}

async function loadQuiz(ctx: Ctx, quizId: string): Promise<Quiz | null | "invalid"> {
	const row = await ctx.storage.quizzes!.get(quizId);
	if (row === null) return null;
	return parse(quizSchema, row) ?? "invalid";
}

/** Public. A course's ordered lessons (ids and titles), one storage get. The kit hides lessons that are not published. */
export async function outline(routeCtx: RouteCtx, ctx: Ctx) {
	const input = parse(courseInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const row = await loadOutline(ctx, input.course);
	return { ok: true, course: input.course, lessons: row?.lessons ?? [] };
}

/** Member. Creates the enrollment row only when absent (compare-and-set with no revision). */
export async function enroll(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(courseInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const course = await ctx.content!.get("lms_courses", input.course).catch(() => null);
	if (!course || course.status !== "published") return fail("COURSE_NOT_FOUND", "That course is not available.");
	const now = nowIso();
	const row: Enrollment = {
		memberId: member,
		courseKey: input.course,
		courseTitle: asString(asRecord(course.data).title),
		startedAt: now,
		updatedAt: now,
		completedAt: null,
		done: [],
	};
	const write = await ctx.storage.enrollments!.compareAndSet(enrollmentId(member, input.course), null, row);
	if (!write.applied) return fail("ALREADY_ENROLLED", "You are already enrolled in this course.");
	return { ok: true, enrollment: row };
}

/**
 * Member. The only writer of progress. Refuses a member who is not enrolled and a lesson that is not
 * in the course outline. Sets completedAt when every lesson in the outline is done.
 */
export async function completeLesson(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(lessonInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const key = enrollmentId(member, input.course);
	const course = await loadOutline(ctx, input.course);
	if (!course?.lessons.some((lesson) => lesson.id === input.lesson)) {
		return fail("LESSON_NOT_IN_COURSE", "That lesson is not part of this course.");
	}
	// Two tries: a second tab marking another lesson at the same moment changes the revision once.
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const current = await ctx.storage.enrollments!.getVersioned(key);
		if (!current) return fail("NOT_ENROLLED", "Enroll in this course first.");
		const row = current.value as Enrollment;
		const done = row.done.includes(input.lesson) ? row.done : [...row.done, input.lesson].slice(-MAX_DONE);
		const finished = course.lessons.every((lesson) => done.includes(lesson.id));
		const next: Enrollment = {
			...row,
			done,
			updatedAt: nowIso(),
			completedAt: row.completedAt ?? (finished ? nowIso() : null),
		};
		if (done === row.done && next.completedAt === row.completedAt) return { ok: true, enrollment: row };
		const write = await ctx.storage.enrollments!.compareAndSet(key, current.revision, next);
		if (write.applied) return { ok: true, enrollment: next };
	}
	return fail("BUSY", "Your progress changed in another tab. Try again.");
}

/** Public. The questions without the correct answers. */
export async function quiz(routeCtx: RouteCtx, ctx: Ctx) {
	const input = parse(quizInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const row = await loadQuiz(ctx, input.quiz);
	if (row === null) return fail("QUIZ_NOT_FOUND", "No quiz on this lesson.");
	if (row === "invalid") return fail("QUIZ_INVALID", "This quiz cannot be shown. The site owner needs to fix it.");
	return {
		ok: true,
		quiz: {
			id: input.quiz,
			title: row.title,
			lessonKey: row.lessonKey,
			questions: row.questions.map((q) => (q.type === "choice" ? { type: q.type, prompt: q.prompt, answers: q.answers } : { type: q.type, prompt: q.prompt })),
		},
	};
}

/** Member. Scores on the server and replaces the member's attempt. Answers which questions were right, never the correct answers. */
export async function submitQuiz(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(submitInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const row = await loadQuiz(ctx, input.quiz);
	if (row === null) return fail("QUIZ_NOT_FOUND", "No quiz on this lesson.");
	if (row === "invalid") return fail("QUIZ_INVALID", "This quiz cannot be scored. The site owner needs to fix it.");
	const valid =
		input.answers.length === row.questions.length &&
		row.questions.every((q, i) => input.answers[i]! <= (q.type === "choice" ? 3 : 1));
	if (!valid) return fail("ANSWER_EVERY_QUESTION", "Answer every question, then submit.");
	const right = row.questions.map((q, i) => input.answers[i] === q.correct);
	const attempt: Attempt = {
		memberId: member,
		quizId: input.quiz,
		lessonKey: row.lessonKey,
		score: right.filter(Boolean).length,
		total: row.questions.length,
		answers: input.answers,
		submittedAt: nowIso(),
	};
	await ctx.storage.attempts!.put(`${member}:${input.quiz}`, attempt);
	return { ok: true, score: attempt.score, total: attempt.total, right };
}

/** Bridge calls one erase may spend on queries and deletes, under the 20 per call cap. */
const ERASE_CALLS = 18;

/**
 * Deletes a member's enrollments and attempts, 100 rows a batch. Stops before the call cap and
 * answers done: false so the caller asks again. Shared by the member route and (step 3) the admin erase.
 */
export async function eraseRows(ctx: Ctx, memberId: string): Promise<{ done: boolean; deleted: number }> {
	let calls = 0;
	let deleted = 0;
	for (const store of ["enrollments", "attempts"] as const) {
		for (;;) {
			if (calls + 2 > ERASE_CALLS) return { done: false, deleted };
			const page = await ctx.storage[store]!.query({ where: { memberId }, limit: 100 });
			calls += 1;
			if (page.items.length > 0) {
				deleted += await ctx.storage[store]!.deleteMany(page.items.map((item) => item.id));
				calls += 1;
			}
			if (!page.hasMore) break;
		}
	}
	return { done: true, deleted };
}

/** Member. Erases the signed-in member's own Learnomy data. */
export async function eraseMember(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	return { ok: true, ...(await eraseRows(ctx, member)) };
}
