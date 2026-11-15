import type { PluginContext } from "emdash/plugin";
import type { z } from "zod/mini";

export type Ctx = PluginContext;
export type Fail = { ok: false; error: { code: string; message: string } };

export const fail = (code: string, message: string): Fail => ({ ok: false, error: { code, message } });
export const BAD_INPUT = fail("INVALID_INPUT", "Something in the request is missing or not valid.");
export const STALE = (what: string) => fail("STALE", `Someone else changed this ${what} since you opened it. Reload it and try again.`);

export function parse<S extends z.ZodMiniType>(schema: S, input: unknown): z.infer<S> | null {
	const parsed = schema.safeParse(input);
	return parsed.success ? parsed.data : null;
}

/** A short version token for a stored row. Every save checks the one the editor loaded. */
export const nowIso = () => new Date().toISOString();
export const newRev = () => crypto.randomUUID().slice(0, 8);
export const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

export const titleOf = (item: { data: unknown; slug?: string | null } | null | undefined, fallback: string) => {
	const title = (item?.data as { title?: unknown } | undefined)?.title;
	return typeof title === "string" && title.trim() ? title.trim() : fallback;
};

/**
 * One progress count for every screen: the done lessons among `lessons`, of `lessons`, finished when
 * every one is done. Visitor screens pass the outline's published lessons; the admin list passes the
 * outline. A done lesson later removed from the outline never counts, so it never reads "7 of 5".
 */
export function countProgress(done: string[], lessons: string[]) {
	const set = new Set(done);
	const count = lessons.filter((id) => set.has(id)).length;
	return { done: count, total: lessons.length, finished: lessons.length > 0 && count === lessons.length };
}
