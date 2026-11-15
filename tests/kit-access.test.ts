import { describe, expect, it } from "vitest";

import { isOpenCourse } from "../site-kit/lib/learnomy";
import catalog from "../site-kit/pages/courses/index.astro?raw";
import course from "../site-kit/pages/courses/[slug].astro?raw";
import lesson from "../site-kit/pages/lessons/[slug].astro?raw";

/**
 * One access rule on every kit screen (issue #18): a course is Open only when access is "open", so a
 * course with no access value never shows an Open badge while its lessons ask to sign in.
 */
describe("course access in the kit", () => {
	it("treats a course with no access value as Members", () => {
		expect(isOpenCourse({ access: "open" })).toBe(true);
		expect(isOpenCourse({ access: "members" })).toBe(false);
		expect(isOpenCourse({})).toBe(false);
		expect(isOpenCourse({ access: "" })).toBe(false);
	});

	it("every page uses that one rule", () => {
		for (const [page, source] of Object.entries({ catalog, course, lesson })) {
			expect(source, page).toContain("isOpenCourse(");
			expect(source, page).not.toMatch(/\.access\s*[!=]==/);
		}
	});
});
