import { z } from "zod/mini";

/**
 * Input schemas for every route. Step 3 declares the admin routes as MCP tools with these same
 * schemas, so one schema validates the HTTP input and describes the tool.
 */

const id = z.string().check(z.trim(), z.minLength(1), z.maxLength(128));

export const courseInput = z.object({ course: id });
export const lessonInput = z.object({ course: id, lesson: id });
export const quizInput = z.object({ quiz: id });
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
	questions: z.array(question).check(z.minLength(1), z.maxLength(MAX_QUESTIONS)),
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

export type Quiz = z.infer<typeof quiz>;
export type Question = z.infer<typeof question>;
export type Outline = z.infer<typeof outline>;

export type Enrollment = {
	memberId: string;
	courseKey: string;
	courseTitle: string;
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
