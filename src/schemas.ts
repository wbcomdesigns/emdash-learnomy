import { z } from "zod/mini";

/**
 * Input schemas for every route. Step 3 declares the admin routes as MCP tools with these same
 * schemas, so one schema validates the HTTP input and describes the tool.
 */

const id = z.string().check(z.trim(), z.minLength(1), z.maxLength(128));

export const courseInput = z.object({ course: id });
export const lessonInput = z.object({ course: id, lesson: id });
export const quizInput = z.object({ quiz: id });
/** The public quiz route finds a lesson's quiz by the lesson. */
/** The catalog asks for lesson counts of up to 24 courses at once, as a comma-separated list. */
export const MAX_CATALOG = 24;
export const catalogInput = z.object({ courses: z.string().check(z.maxLength(MAX_CATALOG * 129)) });
export const lessonQuizInput = z.object({ lesson: id });
export const submitInput = z.object({ quiz: id, answers: z.array(z.int().check(z.minimum(0), z.maximum(3))).check(z.maxLength(20)) });

export const MAX_QUESTIONS = 20;
export const MAX_OUTLINE_LESSONS = 200;
export const MAX_DONE = 500;

const prompt = z.string().check(z.trim(), z.minLength(1), z.maxLength(500));
const answer = z.string().check(z.trim(), z.minLength(1), z.maxLength(200));

export const question = z.discriminatedUnion("type", [
	z.object({ type: z.literal("choice"), prompt, answers: z.array(answer).check(z.length(4)), correct: z.int().check(z.minimum(0), z.maximum(3)) }),
	z.object({ type: z.literal("true_false"), prompt, correct: z.int().check(z.minimum(0), z.maximum(1)) }),
]);

/** A stored quiz. The quiz routes refuse a row that does not match, so a bad question type never reaches a visitor. */
export const quiz = z.object({
	title: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
	lessonKey: z._default(z.string().check(z.maxLength(128)), ""),
	questions: z.array(question).check(z.maxLength(MAX_QUESTIONS)),
	updatedAt: z.string(),
	rev: z.string(),
});

export const outline = z.object({
	courseKey: id,
	courseTitle: z.string().check(z.maxLength(200)),
	lessons: z.array(z.object({ id, title: z.string().check(z.maxLength(200)) })).check(z.maxLength(MAX_OUTLINE_LESSONS)),
	updatedAt: z.string(),
	rev: z.string(),
});

const rev = z.optional(z.string().check(z.maxLength(64)));
const cursor = z.optional(z.string().check(z.maxLength(2000)));
const find = z.optional(z.string().check(z.trim(), z.maxLength(80)));

/* MCP tool and admin inputs (step 3). */
export const setOutlineInput = z.object({ course: id, lessons: z.array(id).check(z.maxLength(MAX_OUTLINE_LESSONS)), rev });
export const listQuizzesInput = z.object({ cursor });
export const saveQuizInput = z.object({
	quiz: z.optional(id),
	title: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
	questions: z.array(question).check(z.maxLength(MAX_QUESTIONS)),
	/** The lesson this quiz belongs to; "" detaches it, absent keeps it. One quiz per lesson. */
	lesson: z.optional(z.union([id, z.literal("")])),
	rev,
});
export const deleteQuizInput = z.object({ quiz: id, rev: z.string().check(z.maxLength(64)) });
export const listInput = z.object({ cursor, find });

export type Quiz = z.infer<typeof quiz>;
export type Question = z.infer<typeof question>;
export type Outline = z.infer<typeof outline>;

export type Enrollment = {
	memberId: string;
	courseKey: string;
	courseTitle: string;
	/** The course's slug when the member enrolled, so Your courses links without a lookup. */
	courseSlug?: string;
	startedAt: string;
	updatedAt: string;
	completedAt: string | null;
	done: string[];
};

export type Attempt = {
	memberId: string;
	quizId: string;
	lessonKey: string;
	score: number;
	total: number;
	answers: number[];
	submittedAt: string;
};
