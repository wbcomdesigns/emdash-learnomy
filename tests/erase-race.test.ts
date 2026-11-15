import { describe, expect, it } from "vitest";

import { eraseRows, submitQuiz } from "../src/learn";

/**
 * A submit that lands while the member's own erase is running (after the erase read the attempt rows,
 * before it deleted them) must still count against the retake limit: the kept count only goes up
 * (security review, 2026-11-15). An in-memory site, so the submit can run inside deleteMany.
 */
function memorySite() {
	let rev = 0;
	const next = () => String((rev += 1));
	const stores = new Map<string, Map<string, { value: unknown; revision: string }>>();
	const kv = new Map<string, { value: unknown; revision: string }>();
	let beforeDelete: (() => Promise<void>) | null = null;
	const collection = (name: string) => {
		const rows = stores.get(name) ?? new Map();
		stores.set(name, rows);
		return {
			get: async (id: string) => rows.get(id)?.value ?? null,
			getVersioned: async (id: string) => rows.get(id) ?? null,
			getMany: async (ids: string[]) => new Map(ids.filter((id) => rows.has(id)).map((id) => [id, rows.get(id)!.value])),
			compareAndSet: async (id: string, expected: string | null, value: unknown) => {
				if ((rows.get(id)?.revision ?? null) !== expected) return { applied: false };
				const revision = next();
				rows.set(id, { value, revision });
				return { applied: true, revision };
			},
			query: async ({ where }: { where: { memberId: string } }) => ({
				items: [...rows].filter(([, row]) => (row.value as { memberId?: string }).memberId === where.memberId).map(([id, row]) => ({ id, data: row.value })),
				hasMore: false,
			}),
			deleteMany: async (ids: string[]) => {
				const hook = beforeDelete;
				beforeDelete = null;
				if (hook) await hook();
				ids.forEach((id) => rows.delete(id));
				return ids.length;
			},
		};
	};
	const ctx = {
		storage: { quizzes: collection("quizzes"), attempts: collection("attempts"), enrollments: collection("enrollments") },
		content: { get: async () => ({ status: "published" }) },
		kv: {
			get: async (key: string) => kv.get(key)?.value ?? null,
			getVersioned: async (key: string) => kv.get(key) ?? null,
			compareAndSet: async (key: string, expected: string | null, value: unknown) => {
				if ((kv.get(key)?.revision ?? null) !== expected) return { applied: false };
				const revision = next();
				kv.set(key, { value, revision });
				return { applied: true, revision };
			},
			set: async (key: string, value: unknown) => void kv.set(key, { value, revision: next() }),
			delete: async (key: string) => kv.delete(key),
		},
	};
	const quiz = { title: "Q", lessonKey: "l1", questions: [{ type: "true_false", prompt: "Yes?", correct: 0 }], retake: { type: "max", attempts: 2 }, updatedAt: "x", rev: "r" };
	stores.get("quizzes")!.set("q1", { value: quiz, revision: next() });
	return { ctx: ctx as never, onDelete: (hook: () => Promise<void>) => (beforeDelete = hook) };
}

describe("erase racing a submit", () => {
	it("a submit landing between the erase's read and delete still counts against the limit", async () => {
		const { ctx, onDelete } = memorySite();
		const submit = () => submitQuiz({ input: { quiz: "q1", answers: [0] }, user: { id: "ana" } }, ctx) as Promise<Record<string, any>>;
		expect((await submit()).attempts).toBe(1);
		onDelete(async () => {
			expect((await submit()).attempts).toBe(2);
		});
		expect((await eraseRows(ctx, "ana", true)).done).toBe(true);
		expect((await submit()).error?.code).toBe("NO_ATTEMPTS_LEFT");
	});
});
