import type { Question, Quiz } from "./schemas";
import { MAX_ATTEMPTS, MAX_QUESTIONS, MAX_WAIT_MINUTES } from "./schemas";
import { type Ctx, type Fail, titleOf, typesMissing } from "./lib/common";
import { getOutline, saveOutline } from "./lib/outlines";
import { FIND_MATCHES, listEnrollments, listResults, LIST_PAGE } from "./lib/people";
import { BLANK, deleteQuiz, getQuiz, listQuizzes, writeQuiz } from "./lib/quizzes";
import { eraseRows } from "./learn";
import { asNumber, asRecord, asString } from "./util";

type Toast = { message: string; type: "success" | "error" | "info" };
type Block = Record<string, unknown>;
export type BlockResponse = { blocks: Block[]; toast?: Toast; navigate?: Record<string, unknown> };
type User = { id: string } | undefined;

/** Paging state carried in button values: where this page starts and the starts of the pages before it. */
type View = { at?: string; back?: string[]; find?: string };

const OUTLINE_PAGE = 10;
const COURSE_PAGE = 25;

const ok = (message: string): Toast => ({ message, type: "success" });
const bad = (message: string): Toast => ({ message, type: "error" });
const header = (text: string): Block => ({ type: "header", text });
const note = (text: string): Block => ({ type: "context", text });
const button = (label: string, action_id: string, value?: unknown, style?: "primary" | "danger" | "secondary", confirm?: Block): Block => ({
	type: "button",
	label,
	action_id,
	...(value === undefined ? {} : { value }),
	...(style ? { style } : {}),
	...(confirm ? { confirm } : {}),
});
const actionsRow = (...elements: Block[]): Block => ({ type: "actions", elements });
const confirmBox = (title: string, text: string, confirm: string): Block => ({ title, text, confirm, deny: "Cancel" });
const statusBadge = (status: string | undefined) => (status === "published" ? "Published" : status ? "Draft" : "Missing");
const viewOf = (value: unknown): View => {
	const v = asRecord(value);
	return { at: asString(v.at) || undefined, back: Array.isArray(v.back) ? v.back.map(asString).slice(-20) : [], find: asString(v.find) || undefined };
};

/** Previous and Next buttons for a list whose page is described by `view`. */
function pager(action: string, view: View, next: string | undefined, extra: Record<string, unknown> = {}): Block[] {
	const elements: Block[] = [];
	if (view.back?.length) {
		const back = [...view.back];
		const at = back.pop();
		elements.push(button("Previous page", action, { ...extra, at, back, find: view.find }));
	}
	if (next) elements.push(button("Next page", action, { ...extra, at: next, back: [...(view.back ?? []), view.at ?? ""], find: view.find }));
	return elements.length ? [actionsRow(...elements)] : [];
}

const failToast = (result: Fail) => bad(result.error.message);
/** "14 Nov 2026" (UTC: a plugin cannot read the site time zone). */
const dayOf = (iso: string) => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const lessonsText = (n: number) => (n === 1 ? "1 lesson" : `${n} lessons`);

/* ---------------- Course outline ---------------- */

async function renderCourses(ctx: Ctx, view: View, toast?: Toast): Promise<BlockResponse> {
	const page = await ctx.content!.list("lms_courses", { orderBy: { title: "asc" }, limit: COURSE_PAGE, ...(view.at ? { cursor: view.at } : {}) });
	const outlines = page.items.length ? await ctx.storage.outlines!.getMany(page.items.map((item) => item.id)) : new Map();
	const rows = page.items.map((item) => ({
		// The lesson count rides in the course cell: four columns clip at 390.
		course: `${titleOf(item, "Untitled course")} (${lessonsText(((outlines.get(item.id) as { lessons?: unknown[] } | undefined)?.lessons ?? []).length)})`,
		status: statusBadge(item.status),
		open: button("Edit outline", "outline_open", { c: item.id }),
	}));
	return {
		blocks: [
			header("Course outline"),
			note("Pick a course to choose its lessons and their order. Lessons show on the course page in that order."),
			rows.length === 0
				? { type: "empty", title: "No courses yet", description: "Write a course under Courses, then come back here to give it lessons." }
				: {
						type: "table",
						page_action_id: "courses_page",
						columns: [
							{ key: "course", label: "Course" },
							{ key: "status", label: "Status", format: "badge" },
							{ key: "open", label: "Actions", format: "element" },
						],
						rows,
					},
			...pager("courses_page", view, page.hasMore ? page.cursor : undefined),
		],
		...(toast ? { toast } : {}),
	};
}

async function renderOutline(ctx: Ctx, course: string, pageNo: number, toast?: Toast): Promise<BlockResponse> {
	const [courseItem, outline] = await Promise.all([ctx.content!.get("lms_courses", course).catch(() => null), getOutline(ctx, course)]);
	if (!courseItem) return renderCourses(ctx, {}, bad("That course no longer exists."));
	const title = titleOf(courseItem, "Untitled course");
	const lessons = outline?.lessons ?? [];
	const pages = Math.max(1, Math.ceil(lessons.length / OUTLINE_PAGE));
	const pageAt = Math.min(Math.max(0, pageNo), pages - 1);
	const shown = lessons.slice(pageAt * OUTLINE_PAGE, (pageAt + 1) * OUTLINE_PAGE);
	// Status of the lessons on this page only: one read each, ten at most.
	const items = await Promise.all(shown.map((lesson) => ctx.content!.get("lms_lessons", lesson.id).catch(() => null)));
	const rev = outline?.rev ?? "";
	const rows = shown.map((lesson, n) => {
		const i = pageAt * OUTLINE_PAGE + n;
		const item = (label: string, a: string) => ({ label, value: JSON.stringify({ a, c: course, i, r: rev, p: pageAt }) });
		return {
			position: i + 1,
			lesson: titleOf(items[n], lesson.title),
			status: statusBadge(items[n]?.status),
			change: {
				type: "menu",
				action_id: "outline_menu",
				label: "Change",
				items: [...(i > 0 ? [item("Move up", "outline_up")] : []), ...(i < lessons.length - 1 ? [item("Move down", "outline_down")] : []), item("Remove from course", "outline_remove")],
			},
		};
	});
	const hidden = rows.filter((r) => r.status !== "Published").length;
	const nav: Block[] = [];
	if (pageAt > 0) nav.push(button("Previous lessons", "outline_open", { c: course, p: pageAt - 1 }));
	if (pageAt < pages - 1) nav.push(button("Next lessons", "outline_open", { c: course, p: pageAt + 1 }));
	return {
		blocks: [
			header(`Outline: ${title}`),
			note(lessons.length ? `${lessonsText(lessons.length)}. Visitors see the published ones in this order.` : "Add the lessons of this course, then put them in order."),
			...(hidden ? [{ type: "banner", variant: "alert", title: `${hidden} lesson${hidden > 1 ? "s" : ""} on this page ${hidden > 1 ? "are" : "is"} not published`, description: hidden > 1 ? "Visitors do not see them. Publish them under Lessons, or remove them here." : "Visitors do not see it. Publish it under Lessons, or remove it here." }] : []),
			rows.length === 0
				? { type: "empty", title: "No lessons in this outline yet", description: "Add lessons by title. You can reorder them after.", actions: [button("Add lessons", "outline_add", { c: course }, "primary")] }
				: {
						type: "table",
						page_action_id: "outline_rows",
						columns: [
							{ key: "position", label: "#", format: "number" },
							{ key: "lesson", label: "Lesson" },
							{ key: "status", label: "Status", format: "badge" },
							{ key: "change", label: "Actions", format: "element" },
						],
						rows,
					},
			...(nav.length ? [actionsRow(...nav)] : []),
			actionsRow(...(rows.length ? [button("Add lessons", "outline_add", { c: course }, "primary")] : []), button("All courses", "courses_page", {})),
		],
		...(toast ? { toast } : {}),
	};
}

async function renderAddLessons(ctx: Ctx, course: string, view: View, toast?: Toast): Promise<BlockResponse> {
	const [courseItem, outline, page] = await Promise.all([
		ctx.content!.get("lms_courses", course).catch(() => null),
		getOutline(ctx, course),
		ctx.content!.list("lms_lessons", { orderBy: { title: "asc" }, limit: COURSE_PAGE, ...(view.at ? { cursor: view.at } : {}) }),
	]);
	if (!courseItem) return renderCourses(ctx, {}, bad("That course no longer exists."));
	const title = titleOf(courseItem, "Untitled course");
	const inOutline = new Set((outline?.lessons ?? []).map((lesson) => lesson.id));
	const rev = outline?.rev ?? "";
	const rows = page.items.map((item) => ({
		lesson: `${titleOf(item, "Untitled lesson")}${inOutline.has(item.id) ? " (in this course)" : ""}`,
		status: statusBadge(item.status),
		add: inOutline.has(item.id) ? null : button("Add", "outline_put", { c: course, l: item.id, r: rev, at: view.at, back: view.back }),
	}));
	return {
		blocks: [
			header(`Add lessons to ${title}`),
			note(`${lessonsText(inOutline.size)} in this course so far. Each one you add goes to the end; reorder them on the outline.`),
			rows.length === 0
				? { type: "empty", title: "No lessons yet", description: "Write lessons under Lessons first. They join a course here." }
				: {
						type: "table",
						page_action_id: "outline_add",
						columns: [
							{ key: "lesson", label: "Lesson" },
							{ key: "status", label: "Status", format: "badge" },
							{ key: "add", label: "Actions", format: "element" },
						],
						rows,
					},
			...pager("outline_add", view, page.hasMore ? page.cursor : undefined, { c: course }),
			actionsRow(button("Back to the outline", "outline_open", { c: course }, "primary")),
		],
		...(toast ? { toast } : {}),
	};
}

async function changeOutline(ctx: Ctx, action: string, value: Record<string, unknown>): Promise<BlockResponse> {
	const course = asString(value.c);
	const rev = asString(value.r);
	const outline = await getOutline(ctx, course);
	const ids = (outline?.lessons ?? []).map((lesson) => lesson.id);
	if ((outline?.rev ?? "") !== rev) return renderOutline(ctx, course, 0, bad("Someone else changed this outline since you opened it. It is reloaded now; try again."));
	if (action === "outline_put") {
		const result = await saveOutline(ctx, course, [...ids, asString(value.l)], rev);
		return renderAddLessons(ctx, course, viewOf(value), result.ok ? ok(`Added "${result.outline.lessons.at(-1)!.title}".`) : failToast(result));
	}
	const i = asNumber(value.i) ?? -1;
	if (i < 0 || i >= ids.length) return renderOutline(ctx, course, 0, bad("That lesson moved. The outline is reloaded now."));
	const next = [...ids];
	let message = "";
	if (action === "outline_remove") {
		next.splice(i, 1);
		message = `Removed "${outline!.lessons[i]!.title}".`;
	} else {
		const j = action === "outline_up" ? i - 1 : i + 1;
		if (j < 0 || j >= next.length) return renderOutline(ctx, course, asNumber(value.p) ?? 0);
		[next[i], next[j]] = [next[j]!, next[i]!];
		message = `Moved "${outline!.lessons[i]!.title}" ${action === "outline_up" ? "up" : "down"}.`;
	}
	const result = await saveOutline(ctx, course, next, rev);
	return renderOutline(ctx, course, asNumber(value.p) ?? 0, result.ok ? ok(message) : failToast(result));
}

/* ---------------- Quizzes ---------------- */

const TYPE_LABEL: Record<Question["type"], string> = {
	choice: "Multiple choice (one answer)",
	multi: "Multiple answers (pick all that apply)",
	true_false: "True or false",
	short: "Short answer",
	blank: "Fill in the blank",
};
const TYPES = Object.keys(TYPE_LABEL) as Question["type"][];
const answerText = (q: Question) =>
	q.type === "choice"
		? (q.answers[q.correct] ?? "")
		: q.type === "multi"
			? q.correct.map((i) => q.answers[i]).join(", ")
			: q.type === "true_false"
				? q.correct === 0
					? "True"
					: "False"
				: q.accepted.join(" / ");

/** The quiz's mode, pass mark and retake policy in one plain line. */
function settingsLine(quiz: Quiz): string {
	const mode = quiz.mode === "practice" ? "Practice: never blocks progress; members see the right answers and explanations after they submit" : quiz.passMark ? `Graded, pass mark ${quiz.passMark}%: members pass it to complete the lesson` : "Graded, no pass mark: the score never blocks progress";
	const r = quiz.retake;
	const retake = r.type === "max" ? `at most ${r.attempts === 1 ? "1 attempt" : `${r.attempts} attempts`}` : r.type === "wait" ? `${r.minutes === 1 ? "1 minute" : `${r.minutes} minutes`} between attempts` : "unlimited attempts";
	return `${mode}; ${retake}.`;
}

function settingsForm(id: string, quiz: Quiz): Block {
	const r = quiz.retake;
	return {
		type: "form",
		block_id: `qs|${id}|${quiz.rev}`,
		fields: [
			{ type: "select", action_id: "mode", label: "Mode", options: [{ label: "Graded", value: "graded" }, { label: "Practice (shows right answers, never blocks)", value: "practice" }], initial_value: quiz.mode },
			{ type: "number_input", action_id: "pass_mark", label: "Pass mark in percent (0 for none; graded quizzes only)", initial_value: quiz.passMark ?? 0, min: 0, max: 100, condition: { field: "mode", eq: "graded" } },
			{
				type: "select",
				action_id: "retake",
				label: "Retakes",
				options: [
					{ label: "Unlimited", value: "unlimited" },
					{ label: "A maximum number of attempts", value: "max" },
					{ label: "A wait before each retry", value: "wait" },
				],
				initial_value: r.type,
			},
			{ type: "number_input", action_id: "attempts", label: "Attempts allowed", initial_value: r.type === "max" ? r.attempts : 3, min: 1, max: MAX_ATTEMPTS, condition: { field: "retake", eq: "max" } },
			{ type: "number_input", action_id: "minutes", label: "Minutes to wait before a retry", initial_value: r.type === "wait" ? r.minutes : 60, min: 1, max: MAX_WAIT_MINUTES, condition: { field: "retake", eq: "wait" } },
		],
		submit: { label: "Save settings", action_id: "quiz_settings" },
	};
}

/** Mode, pass mark and retake policy from the settings form. Out-of-range numbers reach writeQuiz, which says what is wrong. */
function settingsFrom(values: Record<string, unknown>): Pick<Quiz, "mode" | "passMark" | "retake"> {
	const mode = asString(values.mode) === "practice" ? "practice" : "graded";
	const mark = asNumber(values.pass_mark) ?? 0;
	const kind = asString(values.retake);
	const retake: Quiz["retake"] =
		kind === "max" ? { type: "max", attempts: asNumber(values.attempts) ?? 0 } : kind === "wait" ? { type: "wait", minutes: asNumber(values.minutes) ?? 0 } : { type: "unlimited" };
	return { mode, passMark: mode === "graded" && mark !== 0 ? mark : undefined, retake };
}

async function renderQuizzes(ctx: Ctx, view: View, toast?: Toast): Promise<BlockResponse> {
	const page = await listQuizzes(ctx, view.at);
	const rows = page.items.map((quiz) => ({
		quiz: `${quiz.title} (${quiz.questions === 1 ? "1 question" : `${quiz.questions} questions`}${quiz.mode === "practice" ? ", practice" : quiz.passMark ? `, pass mark ${quiz.passMark}%` : ""})`,
		updated: quiz.updatedAt,
		open: button("Edit quiz", "quiz_open", { q: quiz.id }),
	}));
	return {
		blocks: [
			header("Quizzes"),
			{
				type: "form",
				block_id: "quiz_new",
				fields: [{ type: "text_input", action_id: "title", label: "New quiz title" }],
				submit: { label: "Create quiz", action_id: "quiz_create" },
			},
			rows.length === 0 && !view.at
				? { type: "empty", title: "No quizzes yet", description: "Create a quiz above, then add its questions one at a time. Each lesson can have one quiz." }
				: {
						type: "table",
						page_action_id: "quizzes_page",
						columns: [
							{ key: "quiz", label: "Quiz" },
							{ key: "updated", label: "Updated", format: "relative_time" },
							{ key: "open", label: "Actions", format: "element" },
						],
						rows,
					},
			...pager("quizzes_page", view, page.cursor),
		],
		...(toast ? { toast } : {}),
	};
}

/**
 * One question per form. Each kind has its own fields (Block Kit conditions show one kind's fields at a
 * time and take only eq or neq, so choice and multi answers are separate fields).
 */
function questionForm(id: string, quiz: Quiz, index: number | null): Block {
	const q = index === null ? null : quiz.questions[index] ?? null;
	const choice = q?.type === "choice" ? q : null;
	const multi = q?.type === "multi" ? q : null;
	const options = (labels: string[]) => labels.map((label, i) => ({ label, value: String(i) }));
	const accepted = (type: "short" | "blank") => ({
		type: "text_input",
		action_id: `accepted_${type}`,
		label: "Accepted answers, one per line (case and extra spaces are ignored)",
		multiline: true,
		initial_value: q?.type === type ? q.accepted.join("\n") : "",
		condition: { field: "type", eq: type },
	});
	return {
		type: "form",
		block_id: index === null ? `qa|${id}|${quiz.rev}` : `qe|${id}|${quiz.rev}|${index}`,
		fields: [
			{ type: "select", action_id: "type", label: "Kind of question", options: TYPES.map((type) => ({ label: TYPE_LABEL[type], value: type })), initial_value: q?.type ?? "choice" },
			{ type: "text_input", action_id: "prompt", label: `Question (fill in the blank: mark the blank with ${BLANK})`, multiline: true, initial_value: q?.prompt ?? "" },
			...[0, 1, 2, 3].map((i) => ({ type: "text_input", action_id: `answer_${i}`, label: `Answer ${i + 1}`, initial_value: choice?.answers[i] ?? "", condition: { field: "type", eq: "choice" } })),
			{ type: "select", action_id: "correct_choice", label: "Correct answer", options: options(["Answer 1", "Answer 2", "Answer 3", "Answer 4"]), initial_value: String(choice?.correct ?? 0), condition: { field: "type", eq: "choice" } },
			...[0, 1, 2, 3].map((i) => ({ type: "text_input", action_id: `manswer_${i}`, label: `Answer ${i + 1}`, initial_value: multi?.answers[i] ?? "", condition: { field: "type", eq: "multi" } })),
			{ type: "checkbox", action_id: "correct_multi", label: "Right answers (tick every one)", options: options(["Answer 1", "Answer 2", "Answer 3", "Answer 4"]), initial_value: (multi?.correct ?? []).map(String), condition: { field: "type", eq: "multi" } },
			{ type: "select", action_id: "correct_tf", label: "Correct answer", options: options(["True", "False"]), initial_value: String(q?.type === "true_false" ? q.correct : 0), condition: { field: "type", eq: "true_false" } },
			accepted("short"),
			accepted("blank"),
			{ type: "text_input", action_id: "explain", label: "Explanation (optional; members see it after a practice quiz)", multiline: true, initial_value: q?.explain ?? "" },
		],
		submit: { label: index === null ? "Add question" : "Save question", action_id: index === null ? "question_add" : "question_save" },
	};
}

async function renderQuiz(ctx: Ctx, id: string, quiz: Quiz | null, editing: number | null, toast?: Toast, asking?: number): Promise<BlockResponse> {
	const row = quiz ?? (await getQuiz(ctx, id));
	if (!row) return renderQuizzes(ctx, {}, bad("That quiz no longer exists."));
	const rows = row.questions.map((q, i) => ({
		position: i + 1,
		question: q.prompt,
		kind: TYPE_LABEL[q.type],
		answer: answerText(q),
		change: {
			type: "menu",
			action_id: "question_menu",
			label: "Change",
			items: [
				{ label: "Edit question", value: JSON.stringify({ a: "edit", q: id, i }) },
				{ label: "Remove question", value: JSON.stringify({ a: "ask", q: id, i }) },
			],
		},
	}));
	const full = row.questions.length >= MAX_QUESTIONS;
	const lesson = row.lessonKey ? await ctx.content!.get("lms_lessons", row.lessonKey).catch(() => null) : null;
	const lessonLine = !row.lessonKey
		? "Not on a lesson yet. Visitors see a quiz only on its lesson."
		: lesson
			? `On the lesson "${titleOf(lesson, "Untitled lesson")}"${lesson.status === "published" ? "" : " (not published, so visitors do not see the quiz yet)"}.`
			: "Its lesson was deleted. Choose another lesson.";
	return {
		blocks: [
			header(`Quiz: ${row.title}`),
			note(`${row.questions.length} of ${MAX_QUESTIONS} questions. Visitors never see the correct answers before they submit; only a practice quiz shows them, after submitting.`),
			note(settingsLine(row)),
			{
				type: "section",
				text: lessonLine,
				accessory: button(row.lessonKey ? "Change lesson" : "Choose lesson", "quiz_lessons", { q: id }, row.lessonKey ? undefined : "primary"),
			},
			...(row.lessonKey ? [actionsRow(button("Take it off the lesson", "quiz_lesson_set", { q: id, l: "", r: row.rev }))] : []),
			...(asking !== undefined && row.questions[asking]
				? [
						{ type: "banner", variant: "alert", title: `Remove question ${asking + 1}?`, description: `"${row.questions[asking]!.prompt}" is removed from this quiz. Results already saved keep their score.` },
						actionsRow(button("Remove question", "question_remove", { q: id, i: asking, r: row.rev }, "danger"), button("Keep it", "quiz_open", { q: id })),
					]
				: []),
			{
				type: "form",
				block_id: `qt|${id}|${row.rev}`,
				fields: [{ type: "text_input", action_id: "title", label: "Quiz title", initial_value: row.title }],
				submit: { label: "Save title", action_id: "quiz_title" },
			},
			settingsForm(id, row),
			rows.length === 0
				? { type: "empty", title: "No questions yet", description: "Add the first question below: multiple choice, multiple answers, true or false, short answer or fill in the blank." }
				: {
						type: "table",
						page_action_id: "quiz_rows",
						columns: [
							{ key: "position", label: "#", format: "number" },
							{ key: "question", label: "Question" },
							{ key: "kind", label: "Kind" },
							{ key: "answer", label: "Correct answer" },
							{ key: "change", label: "Actions", format: "element" },
						],
						rows,
					},
			editing !== null ? header(`Edit question ${editing + 1}`) : header("Add a question"),
			editing === null && full
				? { type: "banner", variant: "default", title: `This quiz has ${MAX_QUESTIONS} questions`, description: "That is the most a quiz can hold. Remove one to add another." }
				: questionForm(id, row, editing),
			actionsRow(
				...(editing !== null ? [button("Cancel editing", "quiz_open", { q: id })] : []),
				button("All quizzes", "quizzes_page", {}),
				button("Delete quiz", "quiz_delete", { q: id, r: row.rev }, "danger", confirmBox("Delete this quiz?", `Delete "${row.title}"? Lessons that use it show no quiz, and its results stay in Quiz results.`, "Delete")),
			),
		],
		...(toast ? { toast } : {}),
	};
}

/** Lessons by title for a quiz to sit on; lessons that already have a quiz say which. Three calls. */
async function renderQuizLessons(ctx: Ctx, id: string, view: View, toast?: Toast): Promise<BlockResponse> {
	const [row, page] = await Promise.all([
		getQuiz(ctx, id),
		ctx.content!.list("lms_lessons", { orderBy: { title: "asc" }, limit: COURSE_PAGE, ...(view.at ? { cursor: view.at } : {}) }),
	]);
	if (!row) return renderQuizzes(ctx, {}, bad("That quiz no longer exists."));
	const taken = page.items.length
		? await ctx.storage.quizzes!.query({ where: { lessonKey: { in: page.items.map((item) => item.id) } }, limit: 100 })
		: { items: [] };
	const holder = new Map(taken.items.map((item) => [asString(asRecord(item.data).lessonKey), { id: item.id, title: asString(asRecord(item.data).title) }]));
	const rows = page.items.map((item) => {
		const has = holder.get(item.id);
		return {
			lesson: `${titleOf(item, "Untitled lesson")}${has ? ` (quiz: ${has.id === id ? "this one" : has.title || "another quiz"})` : ""}`,
			status: statusBadge(item.status),
			pick: has ? null : button("Use lesson", "quiz_lesson_set", { q: id, l: item.id, r: row.rev }),
		};
	});
	return {
		blocks: [
			header(`Choose a lesson for ${row.title}`),
			note("Each lesson has one quiz. A lesson that already has one says which."),
			rows.length === 0
				? { type: "empty", title: "No lessons yet", description: "Write lessons under Lessons first." }
				: {
						type: "table",
						page_action_id: "quiz_lessons",
						columns: [
							{ key: "lesson", label: "Lesson" },
							{ key: "status", label: "Status", format: "badge" },
							{ key: "pick", label: "Actions", format: "element" },
						],
						rows,
					},
			...pager("quiz_lessons", view, page.hasMore ? page.cursor : undefined, { q: id }),
			actionsRow(button("Back to the quiz", "quiz_open", { q: id }, "primary")),
		],
		...(toast ? { toast } : {}),
	};
}

function questionFrom(values: Record<string, unknown>): Question {
	const prompt = asString(values.prompt);
	const explain = asString(values.explain);
	const extra = explain ? { explain } : {};
	const type = asString(values.type);
	const lines = (key: string) => asString(values[key]).split("\n").map((line) => line.trim()).filter(Boolean);
	if (type === "true_false") return { type, prompt, correct: asString(values.correct_tf) === "1" ? 1 : 0, ...extra };
	if (type === "short" || type === "blank") return { type, prompt, accepted: lines(`accepted_${type}`), ...extra };
	if (type === "multi") {
		const ticked = Array.isArray(values.correct_multi) ? values.correct_multi : [];
		const correct = [...new Set(ticked.map((v) => asNumber(v)).filter((n): n is number => n !== null && n >= 0 && n <= 3))].sort();
		return { type, prompt, answers: [0, 1, 2, 3].map((i) => asString(values[`manswer_${i}`])), correct, ...extra };
	}
	const correct = Math.min(3, Math.max(0, asNumber(values.correct_choice) ?? 0));
	return { type: "choice", prompt, answers: [0, 1, 2, 3].map((i) => asString(values[`answer_${i}`])), correct, ...extra };
}

async function submitQuizForm(ctx: Ctx, action: string, blockId: string, values: Record<string, unknown>): Promise<BlockResponse> {
	if (action === "quiz_create") {
		const title = asString(values.title);
		if (!title) return renderQuizzes(ctx, {}, bad("Give the quiz a title first."));
		const made = await writeQuiz(ctx, null, undefined, () => ({ title, lessonKey: "", questions: [] }));
		return made.ok ? renderQuiz(ctx, made.id, made.quiz, null, ok(`Created "${title}". Add its questions below.`)) : renderQuizzes(ctx, {}, failToast(made));
	}
	const [, id = "", rev = "", index = ""] = blockId.split("|");
	const at = Number(index);
	const result = await writeQuiz(ctx, id, rev, (current) => {
		const quiz = current!;
		if (action === "quiz_title") return { ...quiz, title: asString(values.title) };
		if (action === "quiz_settings") return { ...quiz, ...settingsFrom(values) };
		const q = questionFrom(values);
		if (action === "question_add") return { ...quiz, questions: [...quiz.questions, q] };
		if (!(at >= 0 && at < quiz.questions.length)) return { ok: false, error: { code: "GONE", message: "That question was removed meanwhile." } };
		return { ...quiz, questions: quiz.questions.map((old, i) => (i === at ? q : old)) };
	});
	if (!result.ok) {
		// Keep the owner's typing on a refused question: the form shows again with what was refused.
		const current = await getQuiz(ctx, id);
		return current ? renderQuiz(ctx, id, current, action === "question_save" ? at : null, failToast(result)) : renderQuizzes(ctx, {}, failToast(result));
	}
	const message = action === "quiz_title" ? "Title saved." : action === "quiz_settings" ? "Settings saved." : action === "question_add" ? `Question ${result.quiz.questions.length} added.` : `Question ${at + 1} saved.`;
	return renderQuiz(ctx, id, result.quiz, null, ok(message));
}

/* ---------------- Enrollments and quiz results ---------------- */

function listChrome(action: string, what: string, listed: { total: number; partial: boolean }, view: View): Block[] {
	return [
		{ type: "stats", items: [{ label: view.find ? "Matches" : what, value: listed.total }] },
		{
			type: "form",
			block_id: `${action}_find`,
			fields: [{ type: "text_input", action_id: "find", label: "Find a member by name or email", initial_value: view.find ?? "" }],
			submit: { label: "Find", action_id: `${action}_find` },
		},
		...(view.find
			? [
					note(
						`${listed.partial ? `Find looks through the first 500 members and keeps up to ${FIND_MATCHES} of them. Type more of the name, or search by email to find anyone. ` : ""}${listed.total > LIST_PAGE ? `${LIST_PAGE} per page, newest first. ` : ""}Clear the box and press Find to see everything.`,
					),
				]
			: listed.total > LIST_PAGE
				? [note(`${listed.total} in all, ${LIST_PAGE} per page, newest first.`)]
				: []),
	];
}

async function renderEnrollments(ctx: Ctx, view: View, toast?: Toast): Promise<BlockResponse> {
	const listed = await listEnrollments(ctx, { cursor: view.at, find: view.find });
	const rows = listed.items.map((e) => ({
		member: e.memberName,
		// Progress rides in the course cell (four columns clip at 390). Same count as the member's own
		// screens, on the outline's published lessons: a lesson added after they finished is one more to do.
		course: `${e.courseTitle || "Untitled course"}: ${e.progress.finished ? "finished" : `${e.progress.done} of ${e.progress.total} lessons`}`,
		erase: manageMenu(e.memberId, e.memberName, "enrollments"),
	}));
	return {
		blocks: [
			header("Enrollments"),
			...listChrome("enrollments", "Enrollments", listed, view),
			rows.length === 0
				? view.find
					? { type: "empty", title: "Nothing matches", description: "No enrollment belongs to a member with that name or email." }
					: { type: "empty", title: "No enrollments yet", description: "Members appear here when they enroll in a course." }
				: {
						type: "table",
						page_action_id: "enrollments_page",
						columns: [
							{ key: "member", label: "Member" },
							{ key: "course", label: "Course and progress" },
							{ key: "erase", label: "Actions", format: "element" },
						],
						rows,
					},
			...pager("enrollments_page", view, listed.cursor),
		],
		...(toast ? { toast } : {}),
	};
}

async function renderResults(ctx: Ctx, view: View, toast?: Toast): Promise<BlockResponse> {
	const listed = await listResults(ctx, { cursor: view.at, find: view.find });
	const rows = listed.items.map((a) => ({
		member: a.memberName,
		quiz: `${a.quizTitle}: ${a.score} of ${a.total}, ${dayOf(a.submittedAt)}`,
		best: `${a.best}%`,
		attempts: a.attempts,
		erase: manageMenu(a.memberId, a.memberName, "results"),
	}));
	const matches = (listed.matches ?? []).map((m) => ({ member: m.name, erase: manageMenu(m.id, m.name, "results") }));
	return {
		blocks: [
			header("Quiz results"),
			...listChrome("results", "Quiz results", listed, view),
			rows.length === 0
				? view.find
					? matches.length
						? {
								type: "table",
								page_action_id: "results_page",
								columns: [
									{ key: "member", label: "Member with no quiz results (attempt counts may remain after they erased their own data)" },
									{ key: "erase", label: "Actions", format: "element" },
								],
								rows: matches,
							}
						: { type: "empty", title: "Nothing matches", description: "No quiz result belongs to a member with that name or email." }
					: { type: "empty", title: "No quiz results yet", description: "Each member's latest score, best score and number of attempts on each quiz appear here." }
				: {
						type: "table",
						page_action_id: "results_page",
						columns: [
							{ key: "member", label: "Member" },
							{ key: "quiz", label: "Quiz and latest score" },
							{ key: "best", label: "Best" },
							{ key: "attempts", label: "Attempts", format: "number" },
							{ key: "erase", label: "Actions", format: "element" },
						],
						rows,
					},
			...pager("results_page", view, listed.cursor),
		],
		...(toast ? { toast } : {}),
	};
}

/**
 * The per-row menu on Enrollments and Quiz results, so a member with only quiz results (no
 * enrollment) can be erased too. `from` is the list the erase pages go back to.
 */
function manageMenu(memberId: string, name: string, from: "enrollments" | "results"): Block {
	return { type: "menu", action_id: "member_menu", label: "Manage", items: [{ label: "Erase their data", value: JSON.stringify({ m: memberId, n: name, f: from }) }] };
}

const eraseFrom = (value: Record<string, unknown>) =>
	asString(value.f) === "results" ? { title: "Quiz results", action: "results_page", back: "Show quiz results" } : { title: "Enrollments", action: "enrollments_page", back: "Show enrollments" };

/** Ask once, naming the member, before erasing. No reads: the page names them from the row. */
function askErase(value: Record<string, unknown>): BlockResponse {
	const name = asString(value.n) || "this member";
	const from = eraseFrom(value);
	return {
		blocks: [
			header(from.title),
			{ type: "banner", variant: "alert", title: `Erase ${name}'s Learnomy data?`, description: "Every enrollment, quiz result and past attempt of this member is deleted. This cannot be undone. Their site account stays." },
			actionsRow(button("Erase their data", "member_erase", { m: asString(value.m), n: name, f: asString(value.f) }, "danger"), button("Keep it", from.action, {})),
		],
	};
}

/** Erase one member: up to 18 calls, so the answer is a short page instead of the list. */
async function eraseOne(ctx: Ctx, value: Record<string, unknown>): Promise<BlockResponse> {
	const member = asString(value.m);
	const name = asString(value.n) || "this member";
	const result = await eraseRows(ctx, member);
	const from = eraseFrom(value);
	const back = button(from.back, from.action, {}, "primary");
	if (!result.done) {
		return {
			blocks: [header(from.title), { type: "banner", variant: "alert", title: `Part of ${name}'s data is erased`, description: "There was more than one call could remove. Press Erase again to finish." }, actionsRow(button("Erase again", "member_erase", value, "danger"), back)],
			toast: { message: `Erased part of ${name}'s data. Press Erase again to finish.`, type: "info" },
		};
	}
	return {
		blocks: [header(from.title), { type: "banner", variant: "default", title: `${name}'s Learnomy data is erased`, description: "Their enrollments and quiz results are gone. Their site account stays." }, actionsRow(back)],
		toast: ok(`Erased ${name}'s enrollments and quiz results.`),
	};
}

/* ---------------- Dashboard card ---------------- */

async function renderWidget(ctx: Ctx): Promise<BlockResponse> {
	const [courses, enrollments, attempts] = await Promise.all([
		ctx.content!.list("lms_courses", { where: { status: "published" }, limit: 100 }),
		ctx.storage.enrollments!.count(),
		ctx.storage.attempts!.count(),
	]);
	return {
		blocks: [
			// A fields list, not stats cards: three stat cards overflow a half-width card at 390.
			{
				type: "fields",
				fields: [
					{ label: "Published courses", value: courses.hasMore ? "100+" : String(courses.items.length) },
					{ label: "Enrollments", value: String(enrollments) },
					{ label: "Quiz results", value: String(attempts) },
				],
			},
			actionsRow(
				// A content link to id "new" resolves to /_emdash/admin/content/lms_courses/new, relative, so the
				// card works before Settings > Site URL is set (emdash admin plugin-links.ts resolvePluginLinkTarget).
				{ type: "link", label: "New course", target: { kind: "content", collection: "lms_courses", id: "new" }, appearance: "primary" },
				{ type: "link", label: "Course outline", target: { kind: "plugin-page", path: "/outline" } },
			),
		],
	};
}

/* ---------------- Routing ---------------- */

/** The course the lesson panel asked to open, kept for the next Course outline page load. */
export const openKey = (user: string) => `state:open:${user}`;
/** The quiz the lesson panel asked to open, kept for the next Quizzes page load. */
export const openQuizKey = (user: string) => `state:openquiz:${user}`;

/** The guide that copies the kit and creates the content types, on the repository the plugin names. */
export const INSTALL_GUIDE = "https://github.com/wbcomdesigns/emdash-learnomy/blob/main/docs/website/getting-started/install.md";

/**
 * Every admin screen before the site kit's seed has run (no lms_courses or lms_lessons yet): the next
 * step instead of "Plugin error" (#38). No reads.
 */
function setUpFirst(): BlockResponse {
	return {
		blocks: [
			{
				type: "banner",
				variant: "default",
				title: "Next: copy the site kit",
				description: "Learnomy's Courses and Lessons content types are not on this site yet. Step 2 of the install guide copies the course pages into your site and adds them. Then restart or redeploy the site and come back here.",
			},
			actionsRow({ type: "link", label: "Open the install guide", target: { kind: "external", url: INSTALL_GUIDE }, appearance: "primary" }),
		],
	};
}

export async function handleAdmin(input: unknown, ctx: Ctx, user?: User): Promise<BlockResponse> {
	try {
		return await route(input, ctx, user);
	} catch (error) {
		if (typesMissing(error)) return setUpFirst();
		throw error;
	}
}

async function route(input: unknown, ctx: Ctx, user?: User): Promise<BlockResponse> {
	const raw = asRecord(input);
	const type = asString(raw.type);
	const action = asString(raw.action_id);
	const value = asRecord(raw.value);

	if (type === "page_load") {
		const page = asString(raw.page);
		if (page === "widget:summary") return renderWidget(ctx);
		if (page === "/quizzes") {
			const quiz = user ? await ctx.kv.get<string>(openQuizKey(user.id)) : null;
			if (quiz && user) {
				await ctx.kv.delete(openQuizKey(user.id));
				return renderQuiz(ctx, quiz, null, null);
			}
			return renderQuizzes(ctx, {});
		}
		if (page === "/enrollments") return renderEnrollments(ctx, {});
		if (page === "/results") return renderResults(ctx, {});
		if (user) {
			const course = await ctx.kv.get<string>(openKey(user.id));
			if (course) {
				await ctx.kv.delete(openKey(user.id));
				return renderOutline(ctx, course, 0);
			}
		}
		return renderCourses(ctx, {});
	}

	if (type === "form_submit") {
		const values = asRecord(raw.values);
		const find = asString(values.find).slice(0, 80);
		if (action === "enrollments_find") return renderEnrollments(ctx, { find: find || undefined });
		if (action === "results_find") return renderResults(ctx, { find: find || undefined });
		return submitQuizForm(ctx, action, asString(raw.block_id), values);
	}

	switch (action) {
		case "courses_page":
			return renderCourses(ctx, viewOf(value));
		case "outline_open":
			return renderOutline(ctx, asString(value.c), asNumber(value.p) ?? 0);
		case "outline_add":
			return renderAddLessons(ctx, asString(value.c), viewOf(value));
		case "outline_put":
			return changeOutline(ctx, action, value);
		case "outline_menu": {
			// A row's menu sends the chosen item's value: the action and the row, as JSON.
			let picked: Record<string, unknown> = {};
			try {
				picked = asRecord(JSON.parse(asString(raw.value)));
			} catch {}
			const move = asString(picked.a);
			return ["outline_up", "outline_down", "outline_remove"].includes(move) ? changeOutline(ctx, move, picked) : renderCourses(ctx, {});
		}
		case "quizzes_page":
			return renderQuizzes(ctx, viewOf(value));
		case "quiz_open":
			return renderQuiz(ctx, asString(value.q), null, null);
		case "quiz_lessons":
			return renderQuizLessons(ctx, asString(value.q), viewOf(value));
		case "quiz_lesson_set": {
			const lesson = asString(value.l);
			const result = await writeQuiz(ctx, asString(value.q), asString(value.r), (current) => ({ ...current!, lessonKey: lesson }));
			if (!result.ok) return lesson ? renderQuizLessons(ctx, asString(value.q), {}, failToast(result)) : renderQuiz(ctx, asString(value.q), null, null, failToast(result));
			return renderQuiz(ctx, result.id, result.quiz, null, ok(lesson ? "The quiz is on that lesson now." : "The quiz is off its lesson."));
		}
		case "question_menu": {
			let picked: Record<string, unknown> = {};
			try {
				picked = asRecord(JSON.parse(asString(raw.value)));
			} catch {}
			const at = asNumber(picked.i) ?? 0;
			return picked.a === "edit" ? renderQuiz(ctx, asString(picked.q), null, at) : renderQuiz(ctx, asString(picked.q), null, null, undefined, at);
		}
		case "question_remove": {
			const at = asNumber(value.i) ?? -1;
			const result = await writeQuiz(ctx, asString(value.q), asString(value.r), (current) => ({ ...current!, questions: current!.questions.filter((_, i) => i !== at) }));
			return result.ok ? renderQuiz(ctx, result.id, result.quiz, null, ok(`Question ${at + 1} removed.`)) : renderQuiz(ctx, asString(value.q), null, null, failToast(result));
		}
		case "quiz_delete": {
			const result = await deleteQuiz(ctx, asString(value.q), asString(value.r));
			return renderQuizzes(ctx, {}, result.ok ? ok(`Deleted "${result.title}".`) : failToast(result));
		}
		case "enrollments_page":
			return renderEnrollments(ctx, viewOf(value));
		case "results_page":
			return renderResults(ctx, viewOf(value));
		case "member_menu": {
			let picked: Record<string, unknown> = {};
			try {
				picked = asRecord(JSON.parse(asString(raw.value)));
			} catch {}
			return askErase(picked);
		}
		case "member_erase":
			return eraseOne(ctx, value);
	}
	return renderCourses(ctx, {});
}
