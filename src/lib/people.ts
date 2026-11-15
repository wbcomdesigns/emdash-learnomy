import type { Attempt, Enrollment } from "../schemas";
import { readAttempt } from "./attempts";
import { countProgress, type Ctx } from "./common";

/**
 * Rows per page of the Enrollments and Quiz results lists. users:read has no batch lookup (get,
 * getByEmail and list only), so each page looks up at most this many names one by one and stays under
 * 20 calls (count, query, one batched read of titles, 15 names).
 */
export const LIST_PAGE = 15;
/** Users pages (100 each) Find scans for a name: the first 500 members. An email finds anyone. */
const FIND_PAGES = 5;
/**
 * Members one Find keeps. Their names come with the users page, so they cost no lookups; the cap keeps
 * the `in` filter well under D1's 100 bound parameters per query. More matches set `partial`.
 */
export const FIND_MATCHES = 80;

export type Found = { ids: string[]; names: Map<string, string>; partial: boolean };

const nameOf = (user: { name: string | null; email: string } | null) => (user ? user.name?.trim() || user.email : "Former member");

export async function namesFor(ctx: Ctx, ids: string[], known = new Map<string, string>()): Promise<Map<string, string>> {
	const missing = [...new Set(ids)].filter((id) => !known.has(id));
	const users = await Promise.all(missing.map((id) => ctx.users!.get(id).catch(() => null)));
	const names = new Map(known);
	missing.forEach((id, i) => names.set(id, nameOf(users[i] ?? null)));
	return names;
}

/** Members whose name or email contains `text` (an email is matched exactly, one call). */
export async function findMembers(ctx: Ctx, text: string): Promise<Found> {
	const needle = text.toLowerCase();
	if (needle.includes("@")) {
		const user = await ctx.users!.getByEmail(needle).catch(() => null);
		return user ? { ids: [user.id], names: new Map([[user.id, nameOf(user)]]), partial: false } : { ids: [], names: new Map(), partial: false };
	}
	const names = new Map<string, string>();
	let cursor: string | undefined;
	let more = false;
	for (let page = 0; page < FIND_PAGES; page += 1) {
		const result = await ctx.users!.list({ limit: 100, ...(cursor ? { cursor } : {}) });
		for (const user of result.items) {
			if (!`${user.name ?? ""} ${user.email}`.toLowerCase().includes(needle)) continue;
			if (names.size < FIND_MATCHES) names.set(user.id, nameOf(user));
			else more = true;
		}
		cursor = result.nextCursor;
		if (!cursor) return { ids: [...names.keys()], names, partial: more };
	}
	return { ids: [...names.keys()], names, partial: true };
}

type ListOpts = { cursor?: string; find?: string };
type Listed<T> = { ok: true; total: number; items: T[]; cursor?: string; partial: boolean };

/** Enrollments, newest first, with names and progress (countProgress) against the course outline. At most 18 calls. */
export async function listEnrollments(ctx: Ctx, opts: ListOpts): Promise<Listed<Enrollment & { id: string; memberName: string; progress: ReturnType<typeof countProgress> }>> {
	const found = opts.find ? await findMembers(ctx, opts.find) : null;
	if (found && found.ids.length === 0) return { ok: true, total: 0, items: [], partial: found.partial };
	// With Find, the total and the pages are the matches only, and Next pages through all of them.
	const where = found ? { memberId: { in: found.ids } } : undefined;
	const [total, page] = await Promise.all([
		ctx.storage.enrollments!.count(where),
		ctx.storage.enrollments!.query({
			...(where ? { where, orderBy: { updatedAt: "desc" } } : { orderBy: { startedAt: "desc" } }),
			limit: LIST_PAGE,
			...(opts.cursor ? { cursor: opts.cursor } : {}),
		}),
	]);
	const rows = page.items.map((item) => ({ ...(item.data as Enrollment), id: item.id }));
	const [names, outlines] = await Promise.all([
		namesFor(ctx, rows.map((row) => row.memberId), found?.names),
		rows.length ? ctx.storage.outlines!.getMany([...new Set(rows.map((row) => row.courseKey))]) : new Map(),
	]);
	return {
		ok: true,
		total,
		items: rows.map((row) => ({
			...row,
			memberName: names.get(row.memberId) ?? "Former member",
			progress: countProgress(row.done, ((outlines.get(row.courseKey) as { lessons?: Array<{ id: string }> } | undefined)?.lessons ?? []).map((lesson) => lesson.id)),
		})),
		cursor: page.hasMore ? page.cursor : undefined,
		partial: found?.partial ?? false,
	};
}

/** Quiz results, newest first, with names and quiz titles; each row carries attempts and best (readAttempt). At most 18 calls. */
export async function listResults(ctx: Ctx, opts: ListOpts): Promise<Listed<Attempt & { id: string; memberName: string; quizTitle: string }>> {
	const found = opts.find ? await findMembers(ctx, opts.find) : null;
	if (found && found.ids.length === 0) return { ok: true, total: 0, items: [], partial: found.partial };
	// With Find, the total and the pages are the matches only, and Next pages through all of them.
	const where = found ? { memberId: { in: found.ids } } : undefined;
	const [total, page] = await Promise.all([
		ctx.storage.attempts!.count(where),
		ctx.storage.attempts!.query({
			...(where ? { where } : {}),
			orderBy: { submittedAt: "desc" },
			limit: LIST_PAGE,
			...(opts.cursor ? { cursor: opts.cursor } : {}),
		}),
	]);
	const rows = page.items.flatMap((item) => {
		const row = readAttempt(item.data);
		return row ? [{ ...row, id: item.id }] : [];
	});
	const [names, quizzes] = await Promise.all([
		namesFor(ctx, rows.map((row) => row.memberId), found?.names),
		rows.length ? ctx.storage.quizzes!.getMany([...new Set(rows.map((row) => row.quizId))]) : new Map(),
	]);
	return {
		ok: true,
		total,
		items: rows.map((row) => ({
			...row,
			memberName: names.get(row.memberId) ?? "Former member",
			quizTitle: ((quizzes.get(row.quizId) as { title?: string } | undefined)?.title ?? "Deleted quiz"),
		})),
		cursor: page.hasMore ? page.cursor : undefined,
		partial: found?.partial ?? false,
	};
}
