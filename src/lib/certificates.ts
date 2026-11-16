import type { Enrollment } from "../schemas";
import { type Ctx, fail, titleOf } from "./common";
import { namesFor } from "./people";

/**
 * Certificates live on the enrollment row (owner, 2026-11-15: no new collection). `certToken`:
 * absent or null = not issued yet (a course finished before 0.3.0, issued on first view), "" = the
 * link is switched off, 32 hex characters (128 random bits) = the link is on. One indexed field, so
 * the public page finds a certificate with one query.
 */
export const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const isToken = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

/**
 * What a screen shows of one certificate: the link when on; off when switched off; `issued: false`
 * when it has no link yet (a lazy issue past the view's room or lost to a race), which Turn on issues.
 */
export const certState = ({ certToken }: Pick<Enrollment, "certToken">) => {
	const off = certToken === "";
	return isToken(certToken) ? { token: certToken, on: true, issued: true } : { token: "", on: false, issued: off };
};

export const NOT_FOUND = fail("CERTIFICATE_NOT_FOUND", "No certificate at this address.");
/** The completed rows the lists read: completedAt is a time, so a range on it leaves out null. */
export const COMPLETED = { gt: "" };

type Held = Enrollment & { id: string };

/**
 * Issue a certificate on finished rows that have none yet (courses finished before 0.3.0), at most
 * `room` of them: one guarded update each, so a row erased, switched off or issued meanwhile is never
 * written (updateIf never inserts and checks certToken is still unset). Changes the rows in place.
 * ponytail: rows past `room` are issued on the next view.
 */
export async function issueMissing(ctx: Ctx, rows: Held[], room: number): Promise<void> {
	const due = rows.filter((row) => row.completedAt && (row.certToken === undefined || row.certToken === null)).slice(0, Math.max(0, room));
	await Promise.all(
		due.map(async (row) => {
			const token = newToken();
			const out = await ctx.storage.enrollments!.updateIf(row.id, { where: { certToken: null }, set: { certToken: token } }).catch(() => ({ applied: false as const }));
			if (out.applied) row.certToken = token;
		}),
	);
}

/**
 * Public. The certificate behind a link: the member's name, the course title, the completion date and
 * the issuing site, nothing else (no email, no ids). An unknown, malformed or switched-off token gets
 * the same answer. A member whose account is gone has no certificate. Calls: the lookup, then the
 * member and the course together: 3.
 */
export async function certificate(input: unknown, ctx: Ctx) {
	const token = (input as { token?: unknown } | null)?.token;
	if (!isToken(token)) return NOT_FOUND;
	const page = await ctx.storage.enrollments!.query({ where: { certToken: token }, limit: 1 });
	const row = page.items[0]?.data as Enrollment | undefined;
	if (!row?.completedAt || row.certToken !== token) return NOT_FOUND;
	const [user, course] = await Promise.all([ctx.users!.get(row.memberId).catch(() => null), ctx.content!.get("lms_courses", row.courseKey).catch(() => null)]);
	if (!user) return NOT_FOUND;
	return {
		ok: true,
		certificate: {
			// The name only, never the email: "" lets the kit print its own wording.
			member: user.name?.trim() ?? "",
			course: titleOf(course, row.courseTitle || ""),
			completedAt: row.completedAt,
			site: ctx.site?.name ?? "",
		},
	};
}

/** The member's finished courses Your courses reads, newest first. */
const MY_CERTIFICATES = 50;

/**
 * Member. The signed-in member's certificates: course, completion date, and the link token when it is
 * on. Issues the ones not issued yet. Ordered like myCourses (updatedAt, newest first), so every
 * finished course among Your courses' 50 rows is among these 50 (#43 review L3). Calls: one query,
 * then at most 18 issues: 19.
 */
export async function myCertificates(member: string, ctx: Ctx) {
	const page = await ctx.storage.enrollments!.query({ where: { memberId: member, completedAt: COMPLETED }, orderBy: { updatedAt: "desc" }, limit: MY_CERTIFICATES });
	const rows = page.items.map((item) => ({ ...(item.data as Enrollment), id: item.id }));
	await issueMissing(ctx, rows, 18);
	return { ok: true, items: rows.map((row) => ({ course: row.courseKey, completedAt: row.completedAt, ...certState(row) })) };
}

/**
 * Member. Turn the link of the member's own certificate off, or on again with a new token (the old
 * link never works again). Turning on applies to a switched-off link, or issues a link not issued yet,
 * so two tabs cannot swap a link already shared. Calls: one guarded update; turning on that did not
 * apply tries the not-issued guard, then reads: 3.
 */
export async function setCertificate(member: string, course: string, on: boolean, ctx: Ctx) {
	const id = `${member}:${course}`;
	const token = on ? newToken() : "";
	const out = await ctx.storage.enrollments!.updateIf(id, { where: on ? { certToken: "" } : { completedAt: COMPLETED }, set: { certToken: token } });
	if (out.applied) return { ok: true as const, course, completedAt: (out.data as Enrollment).completedAt, ...certState(out.data as Enrollment) };
	if (!on) return fail("NOT_FINISHED", "There is no certificate for this course.");
	const issued = await ctx.storage.enrollments!.updateIf(id, { where: { certToken: null, completedAt: COMPLETED }, set: { certToken: token } });
	if (issued.applied) return { ok: true as const, course, completedAt: (issued.data as Enrollment).completedAt, ...certState(issued.data as Enrollment) };
	const row = (await ctx.storage.enrollments!.get(id)) as Enrollment | null;
	// Already on (another tab turned it on): answer the link it has.
	if (row?.completedAt && isToken(row.certToken)) return { ok: true as const, course, completedAt: row.completedAt, ...certState(row) };
	return fail("NOT_FINISHED", "Finish this course to get its certificate.");
}

/** Rows per page of the Certificates list: names and issues are one call each per row (8 + 8 + 2). */
export const CERT_PAGE = 8;

/**
 * Admin. A course's certificates, newest first, with member names and whether each link is on.
 * Issues the ones not issued yet. Calls: the count beside the page, 8 names, 8 issues at most: 18.
 */
export async function listCertificates(ctx: Ctx, course: string, cursor?: string) {
	const where = { courseKey: course, completedAt: COMPLETED };
	const [total, page] = await Promise.all([
		ctx.storage.enrollments!.count(where),
		ctx.storage.enrollments!.query({ where, orderBy: { completedAt: "desc" }, limit: CERT_PAGE, ...(cursor ? { cursor } : {}) }),
	]);
	const rows = page.items.map((item) => ({ ...(item.data as Enrollment), id: item.id }));
	const [names] = await Promise.all([namesFor(ctx, rows.map((row) => row.memberId)), issueMissing(ctx, rows, CERT_PAGE)]);
	return {
		ok: true as const,
		total,
		items: rows.map((row) => ({ member: row.memberId, memberName: names.get(row.memberId) ?? "Former member", courseTitle: row.courseTitle, completedAt: row.completedAt!, ...certState(row) })),
		cursor: page.hasMore ? page.cursor : undefined,
	};
}
