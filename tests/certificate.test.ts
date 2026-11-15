import { afterEach, describe, expect, it } from "vitest";

import { ana, ben, courseWithOutline, member, openSite, type Site } from "./site";

let site: Site | undefined;
afterEach(async () => {
	await site?.dispose();
	site = undefined;
});

const root = member("root", 50);
type Out = Record<string, any>;
const TOKEN = /^[0-9a-f]{32}$/;

/** A member signed up on the site with a real account (the public page looks their name up). */
async function person(s: Site, name: string | null, email: string) {
	return (await s.rt.fixtures.user({ email, name: name ?? undefined, role: "subscriber" } as never)).id as string;
}

/** Enroll and finish a 2-lesson course through the routes, as a member does. */
async function finish(s: Site, who: ReturnType<typeof member>, title = "Course A") {
	const { course, lessons } = await courseWithOutline(s, 2, title);
	await s.post("enroll", { course }, who);
	for (const lesson of lessons) await s.post("completeLesson", { course, lesson: lesson.id }, who);
	return course;
}
const row = (s: Site, id: string) => s.rt.inspect.storage.get<Record<string, any>>("enrollments", id);

describe("certificate issue", () => {
	it("finishing a course issues a certificate with a 128-bit link; an unfinished course has none", async () => {
		const s = (site = await openSite());
		const id = await person(s, "Ana Lima", "ana.lima@example.com");
		const ana2 = { ...member(id), name: "Ana Lima" };
		const { course, lessons } = await courseWithOutline(s, 2);
		await s.post("enroll", { course }, ana2);
		await s.post("completeLesson", { course, lesson: lessons[0]!.id }, ana2);
		expect((await row(s, `${id}:${course}`))!.certToken).toBeUndefined();
		await s.post("completeLesson", { course, lesson: lessons[1]!.id }, ana2);
		const token = (await row(s, `${id}:${course}`))!.certToken;
		expect(token).toMatch(TOKEN);
		// Marking a lesson again keeps the same link.
		await s.post("completeLesson", { course, lesson: lessons[0]!.id }, ana2);
		expect((await row(s, `${id}:${course}`))!.certToken).toBe(token);
	});

	it("two members finishing get different links", async () => {
		const s = (site = await openSite());
		const course = await finish(s, ana);
		const { lessons } = { lessons: (await s.rt.inspect.storage.get<Record<string, any>>("outlines", course))!.lessons };
		await s.post("enroll", { course }, ben);
		for (const lesson of lessons) await s.post("completeLesson", { course, lesson: lesson.id }, ben);
		expect((await row(s, `ana:${course}`))!.certToken).not.toBe((await row(s, `ben:${course}`))!.certToken);
	});
});

describe("public certificate route", () => {
	it("answers name, course, date and site only, never the email or an id", async () => {
		const s = (site = await openSite());
		const id = await person(s, "Ana Lima", "ana.lima@example.com");
		const course = await finish(s, { ...member(id), name: "Ana Lima" }, "Bread Basics");
		const stored = (await row(s, `${id}:${course}`))!;
		const out = await s.get("certificate", { token: stored.certToken });
		expect(out).toEqual({ ok: true, certificate: { member: "Ana Lima", course: "Bread Basics", completedAt: stored.completedAt, site: expect.any(String) } });
		const text = JSON.stringify(out);
		for (const secret of ["ana.lima@example.com", id, course, stored.certToken]) expect(text).not.toContain(secret);
	});

	it("a member with no name gets an empty name, still no email", async () => {
		const s = (site = await openSite());
		const id = await person(s, null, "noname@example.com");
		const course = await finish(s, member(id));
		const out = (await s.get("certificate", { token: (await row(s, `${id}:${course}`))!.certToken })) as Out;
		expect(out.certificate.member).toBe("");
		expect(JSON.stringify(out)).not.toContain("noname@example.com");
	});

	it("an unknown, malformed or empty token gets the same not found answer", async () => {
		const s = (site = await openSite());
		await finish(s, ana);
		const answers = await Promise.all([{ token: "0".repeat(32) }, { token: "nope" }, { token: "" }, {}, { token: "A".repeat(32) }].map((input) => s.get("certificate", input)));
		for (const out of answers) expect(out).toEqual(answers[0]);
		expect(answers[0]!.error?.code).toBe("CERTIFICATE_NOT_FOUND");
	});

	it("a deleted member's certificate is not found", async () => {
		const s = (site = await openSite());
		// ana has no account on the test site (a member removed from Users).
		const course = await finish(s, ana);
		expect((await s.get("certificate", { token: (await row(s, `ana:${course}`))!.certToken })).error?.code).toBe("CERTIFICATE_NOT_FOUND");
	});
});

describe("member: Your courses certificates", () => {
	it("lists the member's certificates with their link, turns it off, then on with a new link", async () => {
		const s = (site = await openSite());
		const id = await person(s, "Ana Lima", "ana.lima@example.com");
		const me = { ...member(id), name: "Ana Lima" };
		const course = await finish(s, me);
		const mine = (await s.get("myCertificates", {}, me)) as Out;
		expect(mine.items).toHaveLength(1);
		const first = mine.items[0];
		expect(first).toMatchObject({ course, on: true });
		expect(first.token).toMatch(TOKEN);

		const off = await s.post("setCertificate", { course, on: false }, me);
		expect(off).toMatchObject({ ok: true, on: false, token: "" });
		expect((await s.get("certificate", { token: first.token })).error?.code).toBe("CERTIFICATE_NOT_FOUND");
		expect(((await s.get("myCertificates", {}, me)) as Out).items[0]).toMatchObject({ on: false, token: "" });

		const on = await s.post("setCertificate", { course, on: true }, me);
		expect(on.on).toBe(true);
		expect(on.token).toMatch(TOKEN);
		expect(on.token).not.toBe(first.token);
		expect((await s.get("certificate", { token: on.token })).ok).toBe(true);
		expect((await s.get("certificate", { token: first.token })).error?.code).toBe("CERTIFICATE_NOT_FOUND");
		// Turning on again (a second tab) keeps the link already shared.
		expect((await s.post("setCertificate", { course, on: true }, me)).token).toBe(on.token);
	});

	it("refuses a guest, an unfinished course and another member's course; never reads a member id from the request", async () => {
		const s = (site = await openSite());
		const course = await finish(s, ana);
		expect((await s.get("myCertificates", {})).error?.code).toBe("SIGN_IN_REQUIRED");
		expect((await s.post("setCertificate", { course, on: false })).error?.code).toBe("SIGN_IN_REQUIRED");
		// ben cannot switch ana's link off, even naming her.
		expect((await s.post("setCertificate", { course, on: false, member: "ana" }, ben)).error?.code).toBe("NOT_FINISHED");
		expect((await row(s, `ana:${course}`))!.certToken).toMatch(TOKEN);
		const { course: other } = await courseWithOutline(s, 1, "Course B");
		await s.post("enroll", { course: other }, ana);
		expect((await s.post("setCertificate", { course: other, on: false }, ana)).error?.code).toBe("NOT_FINISHED");
		expect((await s.post("setCertificate", { course: other, on: true }, ana)).error?.code).toBe("NOT_FINISHED");
		expect((await s.post("setCertificate", { course: other }, ana)).error?.code).toBe("INVALID_INPUT");
	});

	it("a course finished before 0.3.0 gets its certificate on the first view of Your courses", async () => {
		const s = (site = await openSite());
		const { course } = await courseWithOutline(s, 1);
		await s.rt.fixtures.plugin.storage("enrollments", `ana:${course}`, { memberId: "ana", courseKey: course, courseTitle: "Course A", startedAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", completedAt: "2026-11-02T00:00:00.000Z", done: ["x"] });
		const mine = (await s.get("myCertificates", {}, ana)) as Out;
		expect(mine.items[0].token).toMatch(TOKEN);
		const stored = (await row(s, `ana:${course}`))!;
		expect(stored.certToken).toBe(mine.items[0].token);
		// Progress is untouched by the issue (a guarded field update, not a rewrite).
		expect(stored.done).toEqual(["x"]);
		expect(((await s.get("myCertificates", {}, ana)) as Out).items[0].token).toBe(mine.items[0].token);
		// A switched-off link is never issued again by a view.
		await s.post("setCertificate", { course, on: false }, ana);
		expect(((await s.get("myCertificates", {}, ana)) as Out).items[0].on).toBe(false);
	});
});

describe("erase removes certificates", () => {
	it("the member's own erase and the admin erase stop the link", async () => {
		const s = (site = await openSite());
		const id = await person(s, "Ana Lima", "ana.lima@example.com");
		const me = { ...member(id), name: "Ana Lima" };
		const course = await finish(s, me);
		const token = (await row(s, `${id}:${course}`))!.certToken;
		expect((await s.get("certificate", { token })).ok).toBe(true);
		await s.post("eraseMember", {}, me);
		expect((await s.get("certificate", { token })).error?.code).toBe("CERTIFICATE_NOT_FOUND");
		expect((await s.get("myCertificates", {}, me)).items).toEqual([]);

		const course2 = await finish(s, me, "Course B");
		const token2 = (await row(s, `${id}:${course2}`))!.certToken;
		await s.rt.admin.act("/enrollments", "member_erase", { value: { m: id, n: "Ana Lima" }, user: root });
		expect((await s.get("certificate", { token: token2 })).error?.code).toBe("CERTIFICATE_NOT_FOUND");
	});
});

describe("admin Certificates page", () => {
	const table = (r: Out) => r.blocks.find((b: Out) => b.type === "table");

	it("lists a course's certificates by member name with the link state, issues old ones, and turns a link off", async () => {
		const s = (site = await openSite());
		const id = await person(s, "Ana Lima", "ana.lima@example.com");
		const course = await finish(s, { ...member(id), name: "Ana Lima" }, "Bread Basics");
		const old = await person(s, "Ben Ode", "ben.ode@example.com");
		await s.rt.fixtures.plugin.storage("enrollments", `${old}:${course}`, { memberId: old, courseKey: course, courseTitle: "Bread Basics", startedAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", completedAt: "2026-11-01T00:00:00.000Z", done: [] });
		await s.rt.fixtures.plugin.storage("enrollments", `x:${course}`, { memberId: "x", courseKey: course, courseTitle: "Bread Basics", startedAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", completedAt: null, done: [] });
		const admin = s.rt.admin;
		let page = (await admin.loadPage("/certificates", { user: root })) as Out;
		const open = table(page).rows.find((r: Out) => r.course === "Bread Basics").open;
		page = (await admin.act("/certificates", open.action_id, { value: open.value, user: root })) as Out;
		expect(page.blocks[0].text).toBe("Certificates: Bread Basics");
		const rows = table(page).rows;
		expect(rows.map((r: Out) => r.member)).toEqual(["Ana Lima", "Ben Ode"]);
		expect(rows[1].finished).toBe("1 Nov 2026, link on");
		expect((await row(s, `${old}:${course}`))!.certToken).toMatch(TOKEN);
		expect(JSON.stringify(page)).not.toContain("ana.lima@example.com");

		const token = (await row(s, `${id}:${course}`))!.certToken;
		const off = rows[0].link;
		page = (await admin.act("/certificates", off.action_id, { value: off.value, user: root })) as Out;
		expect(page.toast).toMatchObject({ type: "success" });
		expect(table(page).rows[0].finished).toContain("link off");
		expect((await s.get("certificate", { token })).error?.code).toBe("CERTIFICATE_NOT_FOUND");
	});

	it("shows an empty state for a course with no certificates", async () => {
		const s = (site = await openSite());
		const { course } = await courseWithOutline(s, 1, "Empty Course");
		const page = (await s.rt.admin.act("/certificates", "cert_open", { value: { c: course, t: "Empty Course" }, user: root })) as Out;
		expect(JSON.stringify(page)).toContain("No certificates yet");
	});
});

describe("agent tools", () => {
	it("listCertificates and turnOffCertificate", async () => {
		const s = (site = await openSite());
		const id = await person(s, "Ana Lima", "ana.lima@example.com");
		const course = await finish(s, { ...member(id), name: "Ana Lima" });
		const tool = (name: string, input: unknown) => s.rt.transport.invokeRoute(`tools/${name}`, input, { method: "POST", user: root } as never) as Promise<Out>;
		const listed = await tool("listCertificates", { course });
		expect(listed.total).toBe(1);
		expect(listed.items[0]).toMatchObject({ member: id, memberName: "Ana Lima", on: true });
		expect((await tool("turnOffCertificate", { course, member: id })).on).toBe(false);
		expect((await tool("listCertificates", { course })).items[0].on).toBe(false);
	});
});
