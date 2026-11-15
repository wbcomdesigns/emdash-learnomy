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
import { gates, grade, hasPassed, MAX_HISTORY, percentOf, readAttempt, retakeState, reviewOf } from "./lib/attempts";
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
/** completeLesson spends two calls on the lesson's quiz and the member's attempt, so it scans 13. */
const COMPLETE_LESSON_PAGES = 13;

type Item = { id: string; slug: string | null; data: unknown };

/**
 * The published entries of a collection among `wanted`, in at most `pages` calls. The first call reads
 * the first 100 published entries (on most sites that finds them all). Once the ids still missing fit
 * in the calls left, each is looked up by id instead, so a draft, scheduled or deleted entry costs one
 * call, not a scan of every page. Otherwise it keeps reading 100 a page.
 * `unchecked` names the ids it never reached (the page cap ran out first). Showing treats them as not
 * published (hidden, never leaked); deciding anything else on them must fail closed (completeLesson
 * counts them as still to do).
 * ponytail: with more missing ids than calls left, an entry past the last page read is not checked.
 * EmDash 1.5 content.list cannot filter by id (emdash dist content-*.mjs findMany: status, authorId,
 * locale, search, dates, bylines only).
 */
export async function findPublished(ctx: Ctx, collection: string, wanted: Set<string>, pages: number): Promise<Map<string, Item> & { unchecked: Set<string> }> {
	const found = new Map<string, Item>();
	let complete = wanted.size === 0;
	let cursor: string | undefined;
	for (let page = 0; page < pages && found.size < wanted.size; page += 1) {
		const missing = [...wanted].filter((id) => !found.has(id));
		if (page > 0 && missing.length <= pages - page) {
			const items = await Promise.all(missing.map((id) => ctx.content!.get(collection, id).catch(() => null)));
			items.forEach((item, i) => {
				if (item?.status === "published") found.set(missing[i]!, item);
			});
			complete = true;
			break;
		}
		const result = await ctx.content!.list(collection, { where: { status: "published" }, limit: 100, ...(cursor ? { cursor } : {}) });
		for (const item of result.items) if (wanted.has(item.id)) found.set(item.id, item);
		if (!result.hasMore || !result.cursor) {
			complete = true;
			break;
		}
		cursor = result.cursor;
	}
	const unchecked = complete || found.size === wanted.size ? new Set<string>() : new Set([...wanted].filter((id) => !found.has(id)));
	return Object.assign(found, { unchecked });
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

const attemptId = (memberId: string, quizId: string) => `${memberId}:${quizId}`;

/**
 * Attempts used and the last attempt time on one quiz with a retake limit: one kv record per member and
 * quiz. Raised before every attempt on a limited quiz is saved and by the member's own erase, never
 * lowered, so erasing cannot reset a limit (owner, 2026-11-15). No answers, scores or progress. The
 * admin erase deletes them.
 */
type Kept = { attempts: number; at: string };
const retakeKey = (memberId: string, quizId: string) => `state:retake:${memberId}:${quizId}`;
/**
 * The quiz ids a member has kept records for, so the admin erase can find them: kv.list(prefix) is
 * not usable here (on D1 a prefix this long fails with "LIKE or GLOB pattern too complex").
 */
const retakeIndex = (memberId: string) => `state:retakes:${memberId}`;
/** ISO times compared as instants (0.1.x rows stored them without milliseconds). */
const at = (iso: string) => Date.parse(iso) || 0;
const later = (a: string, b: string) => (at(a) >= at(b) ? a : b);
const covers = (old: Kept | undefined | null, attempts: number, when: string) => Boolean(old && old.attempts >= attempts && at(old.at) >= at(when));

/**
 * The member's attempt row and their retake standing: attempts used and the last attempt time, the
 * larger of the row and the kept record, so the limit holds with or without an erase and for attempts
 * made before the quiz was limited. Two calls, read together.
 */
async function attemptFor(ctx: Ctx, memberId: string, quizId: string) {
	const [current, kept] = await Promise.all([ctx.storage.attempts!.getVersioned(attemptId(memberId, quizId)), ctx.kv.getVersioned<Kept>(retakeKey(memberId, quizId))]);
	const row = readAttempt(current?.value);
	const left = kept?.value;
	const before: Attempt | null =
		row && (!left || left.attempts <= row.attempts)
			? row
			: left
				? { memberId, quizId, lessonKey: row?.lessonKey ?? "", score: row?.score ?? 0, total: row?.total ?? 0, answers: row?.answers ?? [], submittedAt: later(left.at, row?.submittedAt ?? ""), attempts: left.attempts, best: row?.best ?? 0, history: row?.history ?? [] }
				: null;
	return { current, row, before, kept };
}

/** Add `quizId` to the member's index of kept records. Compare-and-set, `tries` times: 2 calls each. */
async function listKept(ctx: Ctx, memberId: string, quizId: string, tries = 2): Promise<boolean> {
	for (let i = 0; i < tries; i += 1) {
		const index = await ctx.kv.getVersioned<string[]>(retakeIndex(memberId));
		if (index?.value.includes(quizId)) return true;
		if ((await ctx.kv.compareAndSet(retakeIndex(memberId), index?.revision ?? null, [...(index?.value ?? []), quizId])).applied) return true;
	}
	return false;
}

/** Tries a kept record raise gets before it gives up (each retry re-reads: 2 calls). */
const KEEP_TRIES = 3;

/**
 * Raise the kept record to at least `attempts` and `when`, never lower. Compare-and-set until applied,
 * at most `tries` (a retry re-reads): 1 to 2 x tries - 1 calls. false when it could not apply: the
 * caller must not go on.
 */
async function raiseKept(ctx: Ctx, memberId: string, quizId: string, attempts: number, when: string, read: { value: Kept; revision: string } | null, tries = KEEP_TRIES): Promise<boolean> {
	const key = retakeKey(memberId, quizId);
	// A first record is listed in the member's index before it exists (2 calls, a retry 2 more).
	if (!read && !(await listKept(ctx, memberId, quizId, Math.min(tries, 2)))) return false;
	let seen = read;
	for (let i = 0; i < tries; i += 1) {
		if (i > 0) seen = await ctx.kv.getVersioned<Kept>(key);
		// Gone since the first read (an admin erase): list it again before recreating it, or it would
		// have no index entry for the next admin erase to find.
		if (i > 0 && !seen && !(await listKept(ctx, memberId, quizId, 1))) return false;
		const old = seen?.value;
		if (covers(old, attempts, when)) return true;
		const value = { attempts: Math.max(old?.attempts ?? 0, attempts), at: later(old?.at ?? "", when) };
		if ((await ctx.kv.compareAndSet(key, seen?.revision ?? null, value)).applied) return true;
	}
	return false;
}

/** Lesson ids per `in` query, well under D1's 100 bound parameters. */
const IN_CHUNK = 80;

/**
 * The quizzes on `lessons` that gate completion (graded, with a pass mark), keyed by lesson, with
 * whether the member passed each on their best score. Calls: one query per 80 lessons (3 at most for a
 * 200-lesson outline), then the member's attempts in one read: 4 at most.
 */
async function passStates(ctx: Ctx, member: string, lessons: string[]) {
	const chunks = [];
	for (let i = 0; i < lessons.length; i += IN_CHUNK) chunks.push(lessons.slice(i, i + IN_CHUNK));
	const pages = await Promise.all(chunks.map((ids) => ctx.storage.quizzes!.query({ where: { lessonKey: { in: ids } }, limit: 100 })));
	const graded = pages.flatMap((page) => page.items).flatMap((item) => {
		const row = parse(quizSchema, item.data);
		return row && gates(row) ? [{ id: item.id, row }] : [];
	});
	if (!graded.length) return {};
	const attempts = await ctx.storage.attempts!.getMany(graded.map((q) => attemptId(member, q.id)));
	return Object.fromEntries(
		graded.map(({ id, row }) => {
			const attempt = readAttempt(attempts.get(attemptId(member, id)));
			return [row.lessonKey, { passMark: row.passMark!, best: attempt?.best ?? null, passed: hasPassed(row, attempt) }];
		}),
	);
}

/**
 * Member. The signed-in member's enrollment in one course, or null, and when enrolled the pass state of
 * each lesson quiz that has a pass mark (`quizzes`, keyed by lesson). Calls: the enrollment beside the
 * outline, then passStates: 6 at most, 2 on a course without pass marks.
 */
export async function progress(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(courseInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const [row, course] = await Promise.all([ctx.storage.enrollments!.get(enrollmentId(member, input.course)) as Promise<Enrollment | null>, loadOutline(ctx, input.course)]);
	const quizzes = row && course?.lessons.length ? await passStates(ctx, member, course.lessons.map((lesson) => lesson.id)) : {};
	return { ok: true, enrollment: row ?? null, quizzes };
}

/** Courses a member sees on Your courses: the most recently active first. */
const MY_COURSES = 50;
/** Calls myCourses may spend finding which of the member's courses and lessons are published. */
const MY_COURSE_PAGES = 3;
const MY_LESSON_PAGES = 12;
/** The member's most recent attempts Your courses reads to count passed quizzes. */
const MY_ATTEMPTS = 100;

/**
 * Member. The signed-in member's courses with progress, newest activity first. Progress is
 * countProgress against the course's published outline lessons, the same count the course and lesson
 * pages show. A course that is deleted or no longer published comes back with available: false and
 * no link. Calls: the enrollments, their outlines in one read, then the published courses (3 at most)
 * and the published lessons (12 at most), and beside the enrollments the member's latest 100 attempts
 * with their quizzes in one read: 19 at most, 6 on most sites. quizzesPassed counts the course's
 * graded quizzes with a pass mark that the member passed.
 * ponytail: shows the 50 most recent; a "more" page if members ever take more than 50 courses. Counts
 * passes among the latest 100 attempts; a member with more reads older passes as not counted.
 */
export async function myCourses(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const [page, tried] = await Promise.all([
		ctx.storage.enrollments!.query({ where: { memberId: member }, orderBy: { updatedAt: "desc" }, limit: MY_COURSES }),
		ctx.storage.attempts!.query({ where: { memberId: member }, orderBy: { submittedAt: "desc" }, limit: MY_ATTEMPTS }),
	]);
	const rows = page.items.map((item) => item.data as Enrollment);
	if (!rows.length) return { ok: true, items: [] };
	const attempts = tried.items.flatMap((item) => readAttempt(item.data) ?? []);
	const quizRows = attempts.length ? await ctx.storage.quizzes!.getMany([...new Set(attempts.map((a) => a.quizId))]) : new Map();
	// Lessons whose graded quiz the member passed on their best score.
	const passedLessons = new Set(
		attempts.flatMap((a) => {
			const row = parse(quizSchema, quizRows.get(a.quizId));
			return row && gates(row) && hasPassed(row, a) ? [row.lessonKey] : [];
		}),
	);
	const keys = [...new Set(rows.map((row) => row.courseKey))];
	const [outlines, courses] = await Promise.all([ctx.storage.outlines!.getMany(keys), findPublished(ctx, "lms_courses", new Set(keys), MY_COURSE_PAGES)]);
	const lessonsOf = new Map(keys.filter((key) => courses.has(key)).map((key) => [key, parse(outlineSchema, outlines.get(key))?.lessons.map((lesson) => lesson.id) ?? []]));
	const wanted = new Set([...lessonsOf.values()].flat());
	const found = wanted.size ? await findPublished(ctx, "lms_lessons", wanted, MY_LESSON_PAGES) : new Map();
	const items = rows.map((row) => {
		const course = courses.get(row.courseKey);
		const live = (lessonsOf.get(row.courseKey) ?? []).filter((id) => found.has(id));
		const counted = countProgress(row.done, live);
		return {
			course: row.courseKey,
			slug: course ? (course.slug ?? row.courseKey) : "",
			title: course ? titleOf(course, row.courseTitle || "Untitled course") : row.courseTitle,
			available: Boolean(course),
			startedAt: row.startedAt,
			updatedAt: row.updatedAt,
			completedAt: row.completedAt,
			quizzesPassed: live.filter((id) => passedLessons.has(id)).length,
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
 * more to do. A lesson whose quiz is graded with a pass mark is refused until the member's best
 * attempt meets it (practice quizzes never block); a lesson already done stays done. Calls: the outline
 * beside the lesson's quiz, the member's attempt when that quiz has a pass mark, the status of the
 * outline lessons not yet done (13 at most, none when all are done), then getVersioned and
 * compareAndSet, twice at most: 20 at most, 4 on most sites.
 */
export async function completeLesson(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(lessonInput, routeCtx.input);
	if (!input) return BAD_INPUT;
	const key = enrollmentId(member, input.course);
	const [course, quizPage] = await Promise.all([loadOutline(ctx, input.course), ctx.storage.quizzes!.query({ where: { lessonKey: input.lesson }, limit: 1 })]);
	if (!course?.lessons.some((lesson) => lesson.id === input.lesson)) {
		return fail("LESSON_NOT_IN_COURSE", "That lesson is not part of this course.");
	}
	const gate = quizPage.items[0] ? parse(quizSchema, quizPage.items[0].data) : null;
	// Fail closed: a lesson whose stored quiz no longer reads cannot be checked for a pass.
	if (quizPage.items[0] && !gate) return fail("QUIZ_INVALID", "This lesson's quiz cannot be checked. The site owner needs to fix it.");
	const mustPass = gate && gates(gate) && !hasPassed(gate, readAttempt(await ctx.storage.attempts!.get(attemptId(member, quizPage.items[0]!.id)))) ? gate : null;
	// Published status of the outline lessons left to do, looked up once: a retry only has fewer left.
	let live: Awaited<ReturnType<typeof findPublished>> | null = null;
	// Two tries: a second tab marking another lesson at the same moment changes the revision once.
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const current = await ctx.storage.enrollments!.getVersioned(key);
		if (!current) return fail("NOT_ENROLLED", "Enroll in this course first.");
		const row = current.value as Enrollment;
		if (mustPass && !row.done.includes(input.lesson)) {
			return fail("QUIZ_NOT_PASSED", `Pass the quiz on this lesson first: ${mustPass.passMark}% or more.`);
		}
		const done = row.done.includes(input.lesson) ? row.done : [...row.done, input.lesson].slice(-MAX_DONE);
		let finished = false;
		if (!row.completedAt) {
			const left = course.lessons.map((lesson) => lesson.id).filter((id) => !done.includes(id));
			live ??= await findPublished(ctx, "lms_lessons", new Set(left), COMPLETE_LESSON_PAGES);
			// Fail closed: a lesson the scan never reached counts as still to do.
			finished = !left.some((id) => live!.has(id) || live!.unchecked.has(id));
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

/**
 * A published lesson's quiz without the correct answers, accepted answers or explanations, and with its
 * mode, pass mark and retake policy. `member`: also that member's attempts, best score, pass and when
 * they may retry (one call more). Without a member: only for a lesson in a published Open course.
 */
async function lessonQuiz(ctx: Ctx, lesson: string, member: string | null) {
	const [live, page, holders] = await Promise.all([
		published(ctx, "lms_lessons", lesson),
		ctx.storage.quizzes!.query({ where: { lessonKey: lesson }, limit: 1 }),
		member ? null : holdersOf(ctx, lesson),
	]);
	const item = live ? page.items[0] : undefined;
	const row = classify(item?.data);
	if (row === null) return fail("QUIZ_NOT_FOUND", "No quiz on this lesson.");
	if (holders && !holders.some((c) => c.access === "open")) return SIGN_IN;
	if (row === "invalid") return fail("QUIZ_INVALID", "This quiz cannot be shown. The site owner needs to fix it.");
	if (row === "empty") return fail("QUIZ_EMPTY", "This quiz has no questions yet.");
	const id = item!.id;
	const out = {
		ok: true,
		quiz: {
			id,
			title: row.title,
			lessonKey: row.lessonKey,
			mode: row.mode,
			...(row.mode === "graded" && row.passMark !== undefined ? { passMark: row.passMark } : {}),
			retake: row.retake,
			questions: row.questions.map((q) => (q.type === "choice" || q.type === "multi" ? { type: q.type, prompt: q.prompt, answers: q.answers } : { type: q.type, prompt: q.prompt })),
		},
	};
	if (!member) return out;
	const { row: attempt, before } = await attemptFor(ctx, member, id);
	return { ...out, mine: { ...mineOf(row, attempt), attempts: before?.attempts ?? 0, ...retakeState(row, before) } };
}

/** A member's standing on a quiz: what the kit shows above it and after each submit. */
function mineOf(quiz: Quiz, attempt: ReturnType<typeof readAttempt>) {
	return {
		attempts: attempt?.attempts ?? 0,
		best: attempt?.best ?? null,
		passed: gates(quiz) ? hasPassed(quiz, attempt) : null,
		...retakeState(quiz, attempt),
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
	return input ? lessonQuiz(ctx, input.lesson, null) : BAD_INPUT;
}

/** Member. The quiz of any published lesson, for a signed-in member, with their standing. Four calls. */
export async function memberQuiz(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	const input = parse(lessonQuizInput, routeCtx.input);
	return input ? lessonQuiz(ctx, input.lesson, member) : BAD_INPUT;
}

/**
 * Member. Scores on the server and records the attempt in the member's one attempt row: the latest
 * answers, the count, the best percent and a capped history. Refuses a submit the retake policy does
 * not allow yet, saying when the member may retry (retryAt) or that no attempts are left. Answers
 * which questions were right; only a Practice quiz also gets each right answer and explanation.
 * Calls: the quiz, its lesson, the attempt beside the kept retake record, for a quiz with a retake
 * limit the kept record's raise (1 to 4 for the first try with listing it, up to 4 for each of two
 * retries), and compareAndSet: 18 at most.
 */
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
	const quiz = row;
	const right = input.answers.length === quiz.questions.length ? quiz.questions.map((q, i) => grade(q, input.answers[i])) : [null];
	if (right.some((r) => r === null)) return fail("ANSWER_EVERY_QUESTION", "Answer every question, then submit.");
	const key = attemptId(member, input.quiz);
	const { current, before, kept } = await attemptFor(ctx, member, input.quiz);
	const allowed = retakeState(quiz, before);
	if (allowed.attemptsLeft === 0) return { ...fail("NO_ATTEMPTS_LEFT", "You have used every attempt on this quiz."), attemptsLeft: 0 };
	if (allowed.retryAt) return { ...fail("RETRY_LATER", "You can take this quiz again later."), retryAt: allowed.retryAt };
	const now = nowIso();
	const score = right.filter(Boolean).length;
	const total = quiz.questions.length;
	const attempt: Attempt = {
		memberId: member,
		quizId: input.quiz,
		lessonKey: quiz.lessonKey,
		score,
		total,
		answers: input.answers,
		submittedAt: now,
		attempts: (before?.attempts ?? 0) + 1,
		// After the member's own erase, `before` holds only the kept count: the best starts again.
		best: Math.max(before?.best ?? 0, percentOf(score, total)),
		history: [...(before?.history ?? []), { score, total, submittedAt: now }].slice(-MAX_HISTORY),
	};
	// A limited quiz counts the attempt in the kept record first: a crash or a refused write after this
	// leaves the count high (the member loses an attempt), never low. If it cannot apply, nothing is saved.
	const busy = fail("BUSY", "This quiz was submitted in another tab. Reload the page and try again.");
	if (quiz.retake.type !== "unlimited" && !(await raiseKept(ctx, member, input.quiz, attempt.attempts, now, kept))) return busy;
	// A second tab submitting at the same moment must not slip past the attempt limit.
	const write = await ctx.storage.attempts!.compareAndSet(key, current?.revision ?? null, attempt);
	if (!write.applied) return busy;
	return {
		ok: true,
		score,
		total,
		right,
		percent: percentOf(score, total),
		mode: quiz.mode,
		...mineOf(quiz, attempt),
		...(quiz.mode === "practice" ? { review: quiz.questions.map(reviewOf) } : {}),
	};
}

/** Bridge calls one erase may spend on queries and deletes, under the 20 per call cap. */
const ERASE_CALLS = 18;

/**
 * Deletes a member's enrollments and attempts, 100 rows a batch, and stops before the call cap with
 * done: false so the caller asks again. Shared by the member route and the admin erase.
 * `keepRetakes` (the member's own erase): before an attempt row of a quiz that is limited now is
 * deleted, its kept record is raised to the row's attempts and time (a backstop for attempts made
 * before 0.2.0 or while the quiz was unlimited); a row whose raise cannot apply is left for the next
 * call. The admin erase deletes the member's kept records too. Per attempts page: query, the quizzes,
 * the kept records (one list), two calls per record to raise, the delete.
 */
export async function eraseRows(ctx: Ctx, memberId: string, keepRetakes = false): Promise<{ done: boolean; deleted: number }> {
	let calls = 0;
	let deleted = 0;
	const room = (n: number) => calls + n <= ERASE_CALLS;
	for (;;) {
		if (!room(2)) return { done: false, deleted };
		const page = await ctx.storage.enrollments!.query({ where: { memberId }, limit: 100 });
		calls += 1;
		if (page.items.length) deleted += await ctx.storage.enrollments!.deleteMany(page.items.map((item) => item.id));
		calls += page.items.length ? 1 : 0;
		if (!page.hasMore) break;
	}
	for (;;) {
		if (!room(keepRetakes ? 3 : 2)) return { done: false, deleted };
		const page = await ctx.storage.attempts!.query({ where: { memberId }, limit: 100 });
		calls += 1;
		let ids = page.items.map((item) => item.id);
		let skipped = false;
		if (keepRetakes && ids.length) {
			const rows = page.items.flatMap((item) => {
				const row = readAttempt(item.data);
				return row ? [{ id: item.id, row }] : [];
			});
			const quizzes = await ctx.storage.quizzes!.getMany([...new Set(rows.map((r) => r.row.quizId))]);
			calls += 1;
			const safe = new Set(ids.filter((id) => !rows.some((r) => r.id === id)));
			for (const { id, row } of rows) {
				const quiz = parse(quizSchema, quizzes.get(row.quizId));
				if (!quiz || quiz.retake.type === "unlimited") {
					safe.add(id);
					continue;
				}
				// The read, the index (2, one try) and one compare-and-set (one try), keeping a call for the
				// delete: 4 at most per row, never more. A row not raised stays for the next call.
				if (!room(5)) {
					skipped = true;
					continue;
				}
				const read = await ctx.kv.getVersioned<Kept>(retakeKey(memberId, row.quizId));
				calls += 1;
				if (covers(read?.value, row.attempts, row.submittedAt)) {
					safe.add(id);
					continue;
				}
				const raised = await raiseKept(ctx, memberId, row.quizId, row.attempts, row.submittedAt, read, 1);
				calls += read ? 1 : 3; // at most: one CAS, or the index (2) and one CAS
				if (raised) safe.add(id);
				else skipped = true;
			}
			ids = ids.filter((id) => safe.has(id));
		}
		if (ids.length) {
			deleted += await ctx.storage.attempts!.deleteMany(ids);
			calls += 1;
		}
		if (skipped) return { done: false, deleted };
		if (!page.hasMore) break;
	}
	if (!keepRetakes) {
		// The admin erase: every kept record in the member's index, then the index (what is left of it
		// when the calls run out, so the next call carries on).
		// The index is changed first, with compare-and-set: a submit that lists a quiz meanwhile makes it
		// fail and the next call starts again, so no record is left out of the index.
		if (!room(2)) return { done: false, deleted };
		const index = await ctx.kv.getVersioned<string[]>(retakeIndex(memberId));
		calls += 1;
		const quizIds = index?.value ?? [];
		if (quizIds.length) {
			const now = quizIds.slice(0, Math.max(0, ERASE_CALLS - calls - 1));
			const left = quizIds.slice(now.length);
			const changed = left.length ? await ctx.kv.compareAndSet(retakeIndex(memberId), index!.revision, left) : await ctx.kv.compareAndDelete(retakeIndex(memberId), index!.revision);
			calls += 1;
			if (!changed.applied) return { done: false, deleted };
			for (const quizId of now) await ctx.kv.delete(retakeKey(memberId, quizId));
			if (left.length) return { done: false, deleted };
		}
	}
	return { done: true, deleted };
}

/** Member. Erases the signed-in member's own Learnomy data. */
export async function eraseMember(routeCtx: RouteCtx, ctx: Ctx) {
	const member = routeCtx.user?.id;
	if (!member) return SIGN_IN;
	return { ok: true, ...(await eraseRows(ctx, member, true)) };
}
