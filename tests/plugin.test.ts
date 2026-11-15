import { afterEach, describe, expect, it } from "vitest";

import { openSite, type Site } from "./site";

let site: Site | undefined;
afterEach(async () => {
	await site?.dispose();
	site = undefined;
});

describe("manifest and admin", () => {
	it("asks only for content:read and users:read, needs EmDash 1.5, and renders both admin pages", async () => {
		site = await openSite();
		const manifest = site.rt.manifest as unknown as { capabilities: string[]; storage: Record<string, unknown>; admin: { pages: Array<{ path: string }> } };
		expect([...manifest.capabilities].sort()).toEqual(["content:read", "users:read"]);
		expect(Object.keys(manifest.storage).sort()).toEqual(["attempts", "enrollments", "outlines", "quizzes"]);
		for (const page of manifest.admin.pages) {
			expect((await site.rt.admin.loadPage(page.path)).blocks.length).toBeGreaterThan(0);
		}
	});

	it("seeds courses and lessons; lessons carry no course or quiz field (outline and quiz rows hold the links)", async () => {
		site = await openSite();
		const fields = Object.fromEntries((await site.rt.inspect.schema()).map((c) => [c.slug, c.fields.map((f) => f.slug).sort()]));
		expect(fields.lms_courses).toEqual(["access", "content", "cover", "excerpt", "title"]);
		expect(fields.lms_lessons).toEqual(["content", "excerpt", "title"]);
	});
});
