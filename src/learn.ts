import {
	catalogInput,
	courseInput,
	MAX_CATALOG,
	outline as outlineSchema,
	lessonInput,
	MAX_DONE,
	quiz as quizSchema,
	lessonQuizInput,
	submitInput,
	type Attempt,
	type Enrollment,
	type Outline,
	type Quiz,
} from "./schemas";
import { BAD_INPUT, countProgress, type Ctx, fail, nowIso, parse, titleOf } from "./lib/common";
import { coursesOf, getOutline as loadOutline } from "./lib/outlines";
import { asRecord, asString } from "./util";

type RouteCtx = { input: unknown; user?: { id: string } };

const SIGN_IN = fail("SIGN_IN_REQUIRED", "Sign in to continue.");

const enrollmentId = (memberId: string, courseKey: string) => `${memberId}:${courseKey}`;

/** null: no quiz; "invalid": a stored row that does not match the schema; "empty": no questions yet. */
function classify(row: unknown): Quiz | null | "invalid" | "empty" {
	if (row === null || row === undefined) return null;
	const parsed = parse(quizSchema, row);
	if (!parsed) return "invalid";
	return parsed.questions.length ? parsed : "empty";
}

const published = async (ctx: Ctx, collection: string, id: string) =>
	(await ctx.content!.get(collection, id).catch(() => null))?.status === "published";

/** Published lessons a public outline scan reads, 100 a page: the first 1,500 published lessons of a site. */
const LESSON_PAGES = 15;
/** Published courses the catalog scan reads: the first 300. lessonCourses reads up to 1,000. */
const CATALOG_COURSE_PAGES = 3;
const LESSON_COURSE_PAGES = 10;

type Item = { id: string; slug: string | null; data: unknown };

/**
 * The published entries of a collection among `wanted`, in at most `pages` calls. The first call reads
 * the first 100 published entries (on most sites that finds them all). Once the ids still missing fit
 * in the calls left, each is looked up by id instead, so a draft, scheduled or deleted entry costs one
 * call, not a scan of every page. Otherwise it keeps reading 100 a page.
 * ponytail: with more missing ids than calls left, an entry past the last page read counts as not
 * published (hidden, never leaked). EmDash 1.5 content.list cannot filter by id
 * (emdash dist content-*.mjs findMany: status, authorId, locale, search, dates, bylines only).
 */
export async function findPublished(ctx: Ctx, collection: string, wanted: Set<string>, pages: number): Promise<Map<string, Item>> {
	const found = new Map<string, Item>();
	let cursor: string | undefined;
	for (let page = 0; page < pages && found.size < wanted.size; page += 1) {
		const missing = [...wanted].filter((id) => !found.has(id));
		if (page > 0 && missing.length <= pages - page) {
			const items = await Promise.all(missing.map((id) => ctx.content!.get(collection, id).catch(() => null)));
			items.forEach((item, i) => {
				if (item?.status === "published") found.set(missing[i]!, item);
			});
			break;
		}
		const result = await ctx.content!.list(collection, { where: { status: "published" }, limit: 100, ...(cursor ? { cursor } : {}) });
		for (const item of result.items) if (wanted.has(item.id)) found.set(item.id, item);
		if (!result.hasMore || !result.cursor) break;
		cursor = result.cursor;
	}
	return found;
}

export type OutlineLesson = { id: string; title: string; slug: string };

/** An outline's lessons that are published, in outline order, with title and slug. */
function liveLessons(row: Outline | null, found: Map<string, Item>): OutlineLesson[] {
	return (row?.lessons ?? [])
		.filter((lesson) => found.has(lesson.id))
		.map((lesson) => {
			const item = found.get(lesson.id)!;
			return { id: lesson.id, title: titleOf(item, "Untitled lesson"), slug: item.slug ?? item.id };
		});
}

/**
 * A published course's lessons in outline order, published lessons only, so a draft course or a draft
 * lesson title never leaves the site. 17 calls at most, 3 on most sites. null for a course that is not
 * published. Shared by the public outline route and the course structured data (page:metadata).
 */
export async function publishedOutline(ctx: Ctx, course: string): Promise<OutlineLesson[] | null> {
	const [live, row] = await Promise.all([published(ctx, "lms_courses", course), loadOutline(ctx, course)]);
	if (!live) return null;
	const found = await findPublished(ctx, "lms_lessons", new Set((row?.lessons ?? []).map((lesson) => lesson.id)), LESSON_PAGES);
	return liveLessons(row, found);
}

/** Public. A published course's published lessons in outline order, with the slug the kit links to. */
export async function outline(routeCtx: RouteCtx, ctx: Ctx) {
	const input = parse(courseInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	return { ok: true, course: input.course, lessons: (await publishedOutline(ctx, input.course)) ?? [] };
}

/**
 * Public. Lesson counts for the catalog cards, up to 24 courses: the published lessons in each
 * published course's outline, the same lessons the outline route shows. A course that is not
 * published gets 0. Calls: the outlines in one read beside the published courses (3 pages at most),
 * then the published lessons (15 pages at most): 19 at most, 3 on most sites.
 */
export async function catalog(routeCtx: RouteCtx, ctx: Ctx) {
	const input = parse(catalogInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const ids = [...new Set(input.courses.split(",").map((id) => id.trim()).filter(Boolean))];
	if (ids.length > MAX_CATALOG) return BAD_INPUT;
	const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
	if (!ids.length) return { ok: true, counts };
	const [rows, courses] = await Promise.all([ctx.storage.outlines!.getMany(ids), findPublished(ctx, "lms_courses", new Set(ids), CATALOG_COURSE_PAGES)]);
	const outlines = new Map(ids.filter((id) => courses.has(id)).map((id) => [id, parse(outlineSchema, rows.get(id))]));
	const wanted = new Set([...outlines.values()].flatMap((row) => (row?.lessons ?? []).map((lesson) => lesson.id)));
	const found = wanted.size ? await findPublished(ctx, "lms_lessons", wanted, LESSON_PAGES) : new Map();
	for (const [id, row] of outlines) counts[id] = liveLessons(row, found).length;
	return { ok: true, counts };
}

type Holder = { id: string; slug: string; title: string; access: "open" | "members" };

/**
 * The published courses a lesson is in, Open ones first. Calls: the outline scan (5 pages at most),
 * then the published courses (10 at most): 15.
 */
async function holdersOf(ctx: Ctx, lesson: string): Promise<Holder[]> {
	const { courses } = await coursesOf(ctx, lesson);
	if (!courses.length) return [];
	const found = await findPublished(ctx, "lms_courses", new Set(courses.map((c) => c.id)), LESSON_COURSE_PAGES);
	const list = courses
		.filter((c) => found.has(c.id))
		.map((c): Holder => {
			const item = found.get(c.id)!;
			return { id: c.id, slug: item.slug ?? c.id, title: titleOf(item, "Untitled course"), access: asRecord(item.data).access === "open" ? "open" : "members" };
		});
	return list.sort((a, b) => Number(b.access === "open") - Number(a.access === "open"));
}

/**
 * Public. The published courses a published lesson is in, Open ones first, so a lesson page reached
 * without ?course= (search, sitemap, EmDash's own links) can pick its course. Calls: the lesson
 * beside holdersOf: 16 at most.
 */
export async function lessonCourses(routeCtx: RouteCtx, ctx: Ctx) {
	const input = parse(lessonQuizInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const [live, courses] = await Promise.all([published(ctx, "lms_lessons", input.lesson), holdersOf(ctx, input.lesson)]);
	return { ok: true, courses: live ? courses : [] };
}

/** Member. The signed-in member's enrollment in one course, or null. One call. */
export async function progress(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(courseInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const row = (await ctx.storage.enrollments!.get(enrollmentId(member, input.course))) as Enrollment | null;
	return { ok: true, enrollment: row ?? null };
}

/** Courses a member sees on Your courses: the most recently active first. */
const MY_COURSES = 50;
/** Calls myCourses may spend finding which of the member's courses and lessons are published. */
const MY_COURSE_PAGES = 3;
const MY_LESSON_PAGES = 14;

/**
 * Member. The signed-in member's courses with progress, newest activity first. Progress is
 * countProgress against the course's published outline lessons, the same count the course and lesson
 * pages show. A course that is deleted or no longer published comes back with available: false and
 * no link. Calls: the enrollments, their outlines in one read, then the published courses (3 at most)
 * and the published lessons (14 at most): 19 at most, 4 on most sites.
 * ponytail: shows the 50 most recent; a "more" page if members ever take more than 50 courses.
 */
export async function myCourses(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const page = await ctx.storage.enrollments!.query({ where: { memberId: member }, orderBy: { updatedAt: "desc" }, limit: MY_COURSES });
	const rows = page.items.map((item) => item.data as Enrollment);
	if (!rows.length) return { ok: true, items: [] };
	const keys = [...new Set(rows.map((row) => row.courseKey))];
	const [outlines, courses] = await Promise.all([ctx.storage.outlines!.getMany(keys), findPublished(ctx, "lms_courses", new Set(keys), MY_COURSE_PAGES)]);
	const lessonsOf = new Map(keys.filter((key) => courses.has(key)).map((key) => [key, parse(outlineSchema, outlines.get(key))?.lessons.map((lesson) => lesson.id) ?? []]));
	const wanted = new Set([...lessonsOf.values()].flat());
	const found = wanted.size ? await findPublished(ctx, "lms_lessons", wanted, MY_LESSON_PAGES) : new Map();
	const items = rows.map((row) => {
		const course = courses.get(row.courseKey);
		const counted = countProgress(row.done, (lessonsOf.get(row.courseKey) ?? []).filter((id) => found.has(id)));
		return {
			course: row.courseKey,
			slug: course ? (course.slug ?? row.courseKey) : "",
			title: course ? titleOf(course, row.courseTitle || "Untitled course") : row.courseTitle,
			available: Boolean(course),
			startedAt: row.startedAt,
			updatedAt: row.updatedAt,
			completedAt: row.completedAt,
			...counted,
		};
	});
	return { ok: true, items };
}

type Page = {
	url: string;
	title: string | null;
	pageTitle?: string | null;
	description: string | null;
	canonical: string | null;
	image: string | null;
	siteName?: string;
	siteUrl?: string;
	content?: { collection: string; id: string; slug: string | null };
};

/**
 * schema.org Course for a course page, lessons in hasPart. Lesson addresses follow the seed's
 * lms_lessons urlPattern (/lessons/{slug}) with the course the kit lesson page reads from ?course=.
 * Nothing for a draft course (publishedOutline answers none) or any other page.
 */
export async function courseGraph(page: Page, ctx: Ctx) {
	const content = page.content;
	if (!content || content.collection !== "lms_courses") return null;
	const lessons = await publishedOutline(ctx, content.id);
	if (!lessons) return null;
	// Built from the page's own address (a relative canonical resolves against it), never from the
	// site URL setting, which is empty until the owner sets it.
	let url = "";
	let origin = "";
	try {
		const at = new URL(page.canonical || page.url, page.url);
		url = at.href;
		origin = at.origin;
	} catch {
		return null;
	}
	const courseSlug = content.slug ?? content.id;
	return {
		kind: "jsonld" as const,
		id: "learnomy-course",
		graph: {
			"@context": "https://schema.org",
			"@type": "Course",
			"@id": `${url}#course`,
			name: page.pageTitle || page.title || "Course",
			...(page.description ? { description: page.description } : {}),
			url,
			...(page.image ? { image: page.image } : {}),
			isAccessibleForFree: true,
			...(page.siteName ? { provider: { "@type": "Organization", name: page.siteName, url: page.siteUrl || origin } } : {}),
			hasPart: lessons.map((lesson, i) => ({
				"@type": "LearningResource",
				position: i + 1,
				name: lesson.title,
				url: `${origin}/lessons/${encodeURIComponent(lesson.slug)}?course=${encodeURIComponent(courseSlug)}`,
			})),
		},
	};
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
		courseSlug: course.slug ?? "",
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
 * in the course outline. Sets completedAt, once, when every published lesson in the outline is done:
 * a draft, scheduled or deleted lesson in the outline does not hold the course open. completedAt is
 * the first finish; screens show finished from countProgress, so a lesson added later reads as one
 * more to do. Calls: the outline, the status of the outline lessons not yet done (15 at most, none
 * when all are done), then getVersioned and compareAndSet, twice at most: 20 at most, 4 on most sites.
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
	// Published status of the outline lessons left to do, looked up once: a retry only has fewer left.
	let live: Map<string, Item> | null = null;
	// Two tries: a second tab marking another lesson at the same moment changes the revision once.
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const current = await ctx.storage.enrollments!.getVersioned(key);
		if (!current) return fail("NOT_ENROLLED", "Enroll in this course first.");
		const row = current.value as Enrollment;
		const done = row.done.includes(input.lesson) ? row.done : [...row.done, input.lesson].slice(-MAX_DONE);
		let finished = false;
		if (!row.completedAt) {
			const left = course.lessons.map((lesson) => lesson.id).filter((id) => !done.includes(id));
			live ??= left.length ? await findPublished(ctx, "lms_lessons", new Set(left), LESSON_PAGES) : new Map();
			finished = !left.some((id) => live!.has(id));
		}
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

/** A published lesson's quiz without the correct answers. `guest`: only for a lesson in a published Open course. */
async function lessonQuiz(ctx: Ctx, lesson: string, guest: boolean) {
	const [live, page, holders] = await Promise.all([
		published(ctx, "lms_lessons", lesson),
		ctx.storage.quizzes!.query({ where: { lessonKey: lesson }, limit: 1 }),
		guest ? holdersOf(ctx, lesson) : null,
	]);
	const item = live ? page.items[0] : undefined;
	const row = classify(item?.data);
	if (row === null) return fail("QUIZ_NOT_FOUND", "No quiz on this lesson.");
	if (holders && !holders.some((c) => c.access === "open")) return SIGN_IN;
	if (row === "invalid") return fail("QUIZ_INVALID", "This quiz cannot be shown. The site owner needs to fix it.");
	if (row === "empty") return fail("QUIZ_EMPTY", "This quiz has no questions yet.");
	return {
		ok: true,
		quiz: {
			id: item!.id,
			title: row.title,
			lessonKey: row.lessonKey,
			questions: row.questions.map((q) => (q.type === "choice" ? { type: q.type, prompt: q.prompt, answers: q.answers } : { type: q.type, prompt: q.prompt })),
		},
	};
}

/**
 * Public. The quiz of a lesson that is in a published Open course; any other lesson answers
 * SIGN_IN_REQUIRED, the same protection the lesson text has (signed-in members use memberQuiz).
 * Public routes never see the caller (emdash http-route-dispatch: caller is undefined for a public
 * route), hence two routes. Calls: 2 beside holdersOf: 17 at most.
 */
export async function quiz(routeCtx: RouteCtx, ctx: Ctx) {
	const input = parse(lessonQuizInput, routeCtx.input);
	return input ? lessonQuiz(ctx, input.lesson, true) : BAD_INPUT;
}

/** Member. The quiz of any published lesson, for a signed-in member. Two calls. */
export async function memberQuiz(routeCtx: RouteCtx, ctx: Ctx) {
	if (!routeCtx.user?.id) return SIGN_IN;
	const input = parse(lessonQuizInput, routeCtx.input);
	return input ? lessonQuiz(ctx, input.lesson, false) : BAD_INPUT;
}

/** Member. Scores on the server and replaces the member's attempt. Answers which questions were right, never the correct answers. */
export async function submitQuiz(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(submitInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	let row = classify(await ctx.storage.quizzes!.get(input.quiz));
	// Only the quiz of a published lesson takes answers, the same quizzes the public route shows.
	if (row && typeof row === "object" && !(row.lessonKey && (await published(ctx, "lms_lessons", row.lessonKey)))) row = null;
	if (row === null) return fail("QUIZ_NOT_FOUND", "No quiz on this lesson.");
	if (row === "invalid") return fail("QUIZ_INVALID", "This quiz cannot be scored. The site owner needs to fix it.");
	if (row === "empty") return fail("QUIZ_EMPTY", "This quiz has no questions yet.");
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
