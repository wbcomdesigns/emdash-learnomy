import { MAX_OUTLINE_LESSONS, outline as outlineSchema, type Outline } from "../schemas";
import { type Ctx, type Fail, fail, newRev, nowIso, parse, STALE, titleOf } from "./common";

/** New lessons one save may add: each is looked up once, and a save stays at 18 calls. */
export const MAX_NEW_PER_SAVE = 15;

export async function getOutline(ctx: Ctx, course: string): Promise<Outline | null> {
	return parse(outlineSchema, await ctx.storage.outlines!.get(course));
}

/**
 * The one writer of outlines (admin page and the setOutline tool). `lessons` is the full ordered list
 * of lesson ids. `rev` is the version token the editor loaded ("" or absent for a course without an
 * outline): a stale one is refused. Lessons already in the outline keep their stored title; new ones
 * are looked up (they must exist). Calls: getVersioned, the course, up to 15 lessons, the write.
 */
export async function saveOutline(ctx: Ctx, course: string, lessons: string[], rev: string | undefined): Promise<{ ok: true; outline: Outline } | Fail> {
	if (new Set(lessons).size !== lessons.length) return fail("DUPLICATE_LESSON", "A lesson can be in an outline only once.");
	if (lessons.length > MAX_OUTLINE_LESSONS) return fail("TOO_MANY_LESSONS", `An outline holds at most ${MAX_OUTLINE_LESSONS} lessons.`);
	const current = await ctx.storage.outlines!.getVersioned(course);
	const row = current ? parse(outlineSchema, current.value) : null;
	if ((row?.rev ?? "") !== (rev ?? "")) return STALE("outline");
	const known = new Map((row?.lessons ?? []).map((lesson) => [lesson.id, lesson.title]));
	const fresh = lessons.filter((id) => !known.has(id));
	if (fresh.length > MAX_NEW_PER_SAVE) return fail("TOO_MANY_NEW", `Add at most ${MAX_NEW_PER_SAVE} new lessons in one save.`);
	const [courseItem, ...found] = await Promise.all([
		ctx.content!.get("lms_courses", course).catch(() => null),
		...fresh.map((id) => ctx.content!.get("lms_lessons", id).catch(() => null)),
	]);
	if (!courseItem) return fail("COURSE_NOT_FOUND", "That course no longer exists.");
	for (const [i, item] of found.entries()) {
		if (!item) return fail("LESSON_NOT_FOUND", "One of the lessons no longer exists. Reload and try again.");
		known.set(fresh[i]!, titleOf(item, "Untitled lesson"));
	}
	const next: Outline = {
		courseKey: course,
		courseTitle: titleOf(courseItem, "Untitled course"),
		lessons: lessons.map((id) => ({ id, title: known.get(id)! })),
		updatedAt: nowIso(),
		rev: newRev(),
	};
	const write = await ctx.storage.outlines!.compareAndSet(course, current?.revision ?? null, next);
	return write.applied ? { ok: true, outline: next } : STALE("outline");
}
