import { describe, expect, it } from "vitest";

import { catalogPages, isOpenCourse } from "../site-kit/lib/learnomy";
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

describe("catalog pages", () => {
	it("Previous goes back one page, not to the first (issue #19)", () => {
		const p1 = catalogPages(undefined, [], "c2");
		expect(p1.previous).toBeUndefined();
		expect(p1.next).toEqual({ cursor: "c2", back: undefined });
		const p2 = catalogPages("c2", [], "c3");
		expect(p2.previous).toEqual({ cursor: undefined, back: undefined });
		expect(p2.next).toEqual({ cursor: "c3", back: "c2" });
		const p3 = catalogPages("c3", ["c2"], undefined);
		expect(p3.previous).toEqual({ cursor: "c2", back: undefined });
		expect(p3.next).toBeUndefined();
		expect(catalogPages("c4", ["c2", "c3"], "c5").previous).toEqual({ cursor: "c3", back: "c2" });
		expect(catalog).toContain("catalogPages(");
	});
});
