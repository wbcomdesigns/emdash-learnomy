import { openKey, openQuizKey, type BlockResponse } from "./admin";
import { quizForLesson } from "./lib/quizzes";
import { type Ctx } from "./lib/common";
import { asRecord, asString } from "./util";

type RouteCtx = { input: unknown; ui?: { entry?: { collection: string; id: string } }; user?: { id: string } };

/**
 * Outlines one panel load reads (100 a page): the first 500 courses. Outlines have no index by lesson
 * (SCOPE keeps one row per course), so finding a lesson's courses is a scan.
 */
const OUTLINE_PAGES = 5;

async function coursesOf(ctx: Ctx, lesson: string): Promise<{ courses: Array<{ id: string; title: string }>; partial: boolean }> {
	const courses: Array<{ id: string; title: string }> = [];
	let cursor: string | undefined;
	for (let page = 0; page < OUTLINE_PAGES; page += 1) {
		const result = await ctx.storage.outlines!.query({ orderBy: { updatedAt: "desc" }, limit: 100, ...(cursor ? { cursor } : {}) });
		for (const item of result.items) {
			const row = item.data as { courseTitle?: string; lessons?: Array<{ id: string }> };
			if (row.lessons?.some((l) => l.id === lesson)) courses.push({ id: item.id, title: row.courseTitle || "Untitled course" });
		}
		if (!result.hasMore || !result.cursor) return { courses, partial: false };
		cursor = result.cursor;
	}
	return { courses, partial: true };
}

/** The lesson editor panel: the courses this lesson is in, each opening its outline, and the lesson's quiz. */
export async function handlePanel(routeCtx: RouteCtx, ctx: Ctx): Promise<BlockResponse> {
	const lesson = routeCtx.ui?.entry?.id;
	if (!lesson) return { blocks: [{ type: "banner", variant: "default", title: "Save the lesson first", description: "Then add it to a course on the Course outline page." }] };
	const raw = asRecord(routeCtx.input);
	if (asString(raw.type) === "block_action" && asString(raw.action_id) === "open_outline") {
		const course = asString(asRecord(raw.value).c);
		if (course && routeCtx.user) await ctx.kv.set(openKey(routeCtx.user.id), course);
		return { blocks: [], navigate: { kind: "plugin-page", path: "/outline" } };
	}
	if (asString(raw.type) === "block_action" && asString(raw.action_id) === "open_quiz") {
		const quiz = asString(asRecord(raw.value).q);
		if (quiz && routeCtx.user) await ctx.kv.set(openQuizKey(routeCtx.user.id), quiz);
		return { blocks: [], navigate: { kind: "plugin-page", path: "/quizzes" } };
	}
	const [{ courses, partial }, quiz] = await Promise.all([coursesOf(ctx, lesson), quizForLesson(ctx, lesson)]);
	const blocks: Array<Record<string, unknown>> = courses.length
		? [
				{ type: "context", text: courses.length === 1 ? "This lesson is in one course:" : `This lesson is in ${courses.length} courses:` },
				...courses.map((c) => ({ type: "section", text: c.title, accessory: { type: "button", label: "Open outline", action_id: "open_outline", value: { c: c.id } } })),
			]
		: [
				{ type: "context", text: "This lesson is not in a course yet." },
				{ type: "actions", elements: [{ type: "button", label: "Open Course outline", action_id: "open_outline", value: {} }] },
			];
	if (partial) blocks.push({ type: "context", text: "Checked the 500 most recently changed course outlines." });
	blocks.push({ type: "divider" });
	blocks.push(
		quiz
			? { type: "section", text: `Quiz: ${quiz.quiz.title}`, accessory: { type: "button", label: "Edit quiz", action_id: "open_quiz", value: { q: quiz.id } } }
			: { type: "section", text: "No quiz on this lesson. Give it one on the Quizzes page.", accessory: { type: "button", label: "Open Quizzes", action_id: "open_quiz", value: {} } },
	);
	return { blocks };
}
