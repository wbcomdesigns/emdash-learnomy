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
const pick = z.int().check(z.minimum(0), z.maximum(3));
/** One answer per question: an index (choice, true_false), indexes (multi) or typed text (short, blank). */
export const submitInput = z.object({
	quiz: id,
	answers: z.array(z.union([pick, z.array(pick).check(z.maxLength(4)), z.string().check(z.maxLength(200))])).check(z.maxLength(20)),
});

export const MAX_QUESTIONS = 20;
export const MAX_OUTLINE_LESSONS = 200;
export const MAX_DONE = 500;

const prompt = z.string().check(z.trim(), z.minLength(1), z.maxLength(500));
const answer = z.string().check(z.trim(), z.minLength(1), z.maxLength(200));

/** Shown with the right answer after a Practice quiz is submitted; never on a quiz route. */
const explain = z.optional(z.string().check(z.trim(), z.maxLength(1000)));
/** Typed answers the owner accepts; case and extra spacing are ignored when grading. */
const accepted = z.array(answer).check(z.minLength(1), z.maxLength(10));
const four = z.array(answer).check(z.length(4));

export const question = z.discriminatedUnion("type", [
	z.object({ type: z.literal("choice"), prompt, answers: four, correct: pick, explain }),
	z.object({ type: z.literal("true_false"), prompt, correct: z.int().check(z.minimum(0), z.maximum(1)), explain }),
	z.object({ type: z.literal("multi"), prompt, answers: four, correct: z.array(pick).check(z.minLength(1), z.maxLength(4)), explain }),
	z.object({ type: z.literal("short"), prompt, accepted, explain }),
	z.object({ type: z.literal("blank"), prompt, accepted, explain }),
]);

export const MAX_ATTEMPTS = 100;
export const MAX_WAIT_MINUTES = 43200;
export const retake = z.discriminatedUnion("type", [
	z.object({ type: z.literal("unlimited") }),
	z.object({ type: z.literal("max"), attempts: z.int().check(z.minimum(1), z.maximum(MAX_ATTEMPTS)) }),
	z.object({ type: z.literal("wait"), minutes: z.int().check(z.minimum(1), z.maximum(MAX_WAIT_MINUTES)) }),
]);
const passMark = z.int().check(z.minimum(1), z.maximum(100));
const mode = z.enum(["graded", "practice"]);

/**
 * A stored quiz. The quiz routes refuse a row that does not match, so a bad question type never reaches
 * a visitor. A 0.1.x row has no mode, pass mark or retake: it reads as graded, no pass mark, unlimited.
 */
export const quiz = z.object({
	title: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
	lessonKey: z._default(z.string().check(z.maxLength(128)), ""),
	questions: z.array(question).check(z.maxLength(MAX_QUESTIONS)),
	mode: z._default(mode, "graded"),
	passMark: z.optional(passMark),
	retake: z._default(retake, { type: "unlimited" }),
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
	/** Left out keeps the stored value. passMark null removes it. */
	mode: z.optional(mode),
	passMark: z.optional(z.nullable(passMark)),
	retake: z.optional(retake),
	rev,
});
export const deleteQuizInput = z.object({ quiz: id, rev: z.string().check(z.maxLength(64)) });
export const listInput = z.object({ cursor, find });
/* 0.3.0 certificates. */
export const setCertificateInput = z.object({ course: id, on: z.boolean() });
export const listCertificatesInput = z.object({ course: id, cursor });
export const certificateOffInput = z.object({ course: id, member: id });

export type Quiz = z.infer<typeof quiz>;
export type Question = z.infer<typeof question>;
export type Retake = z.infer<typeof retake>;
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
	/** 0.3.0 certificate link: absent or null not issued yet, "" switched off, 32 hex characters on. */
	certToken?: string | null;
};

/** One submission kept in an attempt row's history. */
export type Try = { score: number; total: number; submittedAt: string };

/**
 * One row per member and quiz. score, total, answers and submittedAt are the latest submission (the
 * 0.1.x shape); attempts counts every submission, best is the best percent, history keeps the latest
 * MAX_HISTORY. A 0.1.x row reads as one attempt (readAttempt).
 */
export type Attempt = {
	memberId: string;
	quizId: string;
	lessonKey: string;
	score: number;
	total: number;
	answers: unknown[];
	submittedAt: string;
	attempts: number;
	best: number;
	history: Try[];
};
