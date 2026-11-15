import type { SandboxedMcpTool } from "emdash/plugin";

import { BAD_INPUT, type Ctx, parse } from "./lib/common";
import { getOutline, saveOutline } from "./lib/outlines";
import { listEnrollments, listResults } from "./lib/people";
import { deleteQuiz, getQuiz, listQuizzes, writeQuiz } from "./lib/quizzes";
import { courseInput, deleteQuizInput, listInput, listQuizzesInput, quizInput, saveQuizInput, setOutlineInput } from "./schemas";

type RouteCtx = { input: unknown };

/** Private admin routes behind Learnomy's MCP tools. Each validates with the schema its tool declares. */
export const toolRoutes = {
	"tools/getOutline": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(courseInput, routeCtx.input);
		if (!input) return BAD_INPUT;
		const outline = await getOutline(ctx, input.course);
		return { ok: true, course: input.course, courseTitle: outline?.courseTitle ?? "", lessons: outline?.lessons ?? [], rev: outline?.rev ?? "" };
	},
	"tools/setOutline": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(setOutlineInput, routeCtx.input);
		if (!input) return BAD_INPUT;
		return saveOutline(ctx, input.course, input.lessons, input.rev);
	},
	"tools/listQuizzes": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(listQuizzesInput, routeCtx.input ?? {});
		if (!input) return BAD_INPUT;
		return { ok: true, ...(await listQuizzes(ctx, input.cursor)) };
	},
	"tools/getQuiz": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(quizInput, routeCtx.input);
		if (!input) return BAD_INPUT;
		const quiz = await getQuiz(ctx, input.quiz);
		return quiz ? { ok: true, id: input.quiz, ...quiz } : { ok: false, error: { code: "QUIZ_NOT_FOUND", message: "No quiz with that id." } };
	},
	"tools/saveQuiz": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(saveQuizInput, routeCtx.input);
		if (!input) return BAD_INPUT;
		return writeQuiz(ctx, input.quiz ?? null, input.rev, (current) => ({
			title: input.title,
			lessonKey: input.lesson ?? current?.lessonKey ?? "",
			questions: input.questions,
			mode: input.mode ?? current?.mode,
			passMark: input.passMark === null ? undefined : (input.passMark ?? current?.passMark),
			retake: input.retake ?? current?.retake,
		}));
	},
	"tools/deleteQuiz": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(deleteQuizInput, routeCtx.input);
		if (!input) return BAD_INPUT;
		return deleteQuiz(ctx, input.quiz, input.rev);
	},
	"tools/listEnrollments": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(listInput, routeCtx.input ?? {});
		if (!input) return BAD_INPUT;
		return listEnrollments(ctx, input);
	},
	"tools/listResults": async (routeCtx: RouteCtx, ctx: Ctx) => {
		const input = parse(listInput, routeCtx.input ?? {});
		if (!input) return BAD_INPUT;
		return listResults(ctx, input);
	},
};

// SandboxedMcpTool types its schemas as full zod's ZodType; zod/mini schemas share the same core and
// the plugin CLI converts any `_zod` schema with z.toJSONSchema (plugin-cli dist/index.mjs:1008).
const schema = (s: unknown) => s as SandboxedMcpTool["input"];

export const mcpTools: Record<string, SandboxedMcpTool> = {
	getOutline: { description: "Read a Learnomy course outline: its lessons in order (ids and titles) and the version token to pass to setOutline.", route: "tools/getOutline", input: schema(courseInput) },
	setOutline: { description: "Replace a course's outline with these lesson ids in this order. Pass the rev from getOutline (empty for a course without one). At most 15 lessons new to the outline per call.", route: "tools/setOutline", input: schema(setOutlineInput), destructive: true },
	listQuizzes: { description: "List Learnomy quizzes, newest first, 25 a page, with their version tokens.", route: "tools/listQuizzes", input: schema(listQuizzesInput) },
	getQuiz: { description: "Read one quiz with its questions, correct and accepted answers, explanations, mode, pass mark and retake policy.", route: "tools/getQuiz", input: schema(quizInput) },
	saveQuiz: {
		description:
			"Create a quiz (no quiz id) or replace one (quiz id and its rev). Questions, at most 20: choice (four answers, correct 0-3), true_false (correct 0 true, 1 false), multi (four answers, correct: every right index), short (accepted: typed answers), blank (prompt marks the blank with ___, accepted: typed answers); typed answers ignore case and extra spacing; each may carry an explain shown after a practice quiz. mode graded or practice (practice never blocks progress and shows right answers after submit); passMark 1-100 percent (null removes it) makes a graded quiz block completing its lesson until passed; retake {type:unlimited} or {type:max, attempts} or {type:wait, minutes}. Leaving mode, passMark or retake out keeps them. lesson: the lesson entry id it belongs to (an empty string takes it off, leaving it out keeps it); a lesson that already has another quiz is refused.",
		route: "tools/saveQuiz",
		input: schema(saveQuizInput),
		destructive: true,
	},
	deleteQuiz: { description: "Delete a quiz. Pass its rev from listQuizzes or getQuiz.", route: "tools/deleteQuiz", input: schema(deleteQuizInput), destructive: true },
	listEnrollments: { description: "List enrollments newest first with member names and progress, 15 a page; find filters by member name or email.", route: "tools/listEnrollments", input: schema(listInput) },
	listResults: { description: "List quiz results newest first with member names, quiz titles, latest score, best percent and number of attempts, 15 a page; find filters by member name or email.", route: "tools/listResults", input: schema(listInput) },
};
