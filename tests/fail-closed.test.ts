import { describe, expect, it } from "vitest";

import { completeLesson, findPublished } from "../src/learn";

/**
 * A site with more published lessons than the scan reads: content.list always has another page and
 * never reaches the outline's lessons (they sit past lesson 1,500). Security review of the M2 fix.
 */
function bigSite(outline: string[], done: string[]) {
	let row: Record<string, unknown> = { memberId: "ana", courseKey: "c", courseTitle: "C", startedAt: "x", updatedAt: "x", completedAt: null, done };
	let page = 0;
	const ctx = {
		content: {
			list: async () => ({ items: [{ id: `other-${page++}`, status: "published", slug: null, data: {} }], hasMore: true, cursor: `p${page}` }),
			get: async () => null,
		},
		storage: {
			quizzes: { query: async () => ({ items: [] }) },
			outlines: { get: async () => ({ courseKey: "c", courseTitle: "C", lessons: outline.map((id) => ({ id, title: id })), updatedAt: "x", rev: "r" }) },
			enrollments: {
				getVersioned: async () => ({ value: row, revision: "1" }),
				compareAndSet: async (_key: string, _rev: string, next: Record<string, unknown>) => ((row = next), { applied: true, revision: "2" }),
			},
		},
	};
	return { ctx: ctx as never, row: () => row };
}

describe("published checks fail closed", () => {
	it("findPublished names the ids it never reached", async () => {
		const { ctx } = bigSite([], []);
		const found = await findPublished(ctx, "lms_lessons", new Set(Array.from({ length: 20 }, (_, i) => `far-${i}`)), 15);
		expect(found.size).toBe(0);
		expect(found.unchecked.size).toBe(20);
	});

	it("completeLesson never finishes a course while lessons beyond the scan cap are unchecked", async () => {
		const far = Array.from({ length: 20 }, (_, i) => `far-${i}`);
		const { ctx, row } = bigSite(["first", ...far], []);
		const out = (await completeLesson({ input: { course: "c", lesson: "first" }, user: { id: "ana" } }, ctx)) as { ok: boolean; enrollment: { completedAt: string | null } };
		expect(out.ok).toBe(true);
		expect(out.enrollment.completedAt).toBeNull();
		expect(row().completedAt).toBeNull();
	});
});
