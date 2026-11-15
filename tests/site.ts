import { createPluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import seed from "../site-kit/seed/learnomy-seed.json";

export const member = (id: string, role = 10) => ({
	id,
	email: `${id}@example.com`,
	name: id,
	role,
	createdAt: "2026-01-01T00:00:00.000Z",
});
export const ana = member("ana");
export const ben = member("ben");

type Out = Record<string, unknown> & { ok?: boolean; error?: { code: string } };

/** A test site with the Learnomy seed collections. Call dispose() in afterEach. */
export async function openSite() {
	const rt = await createPluginRuntimeTestHost();
	for (const collection of seed.collections) await rt.fixtures.collection(collection as never);
	const get = (name: string, input?: unknown) => rt.transport.invokeRoute(name, input, { method: "GET" } as never) as Promise<Out>;
	const post = (name: string, input: unknown, user?: ReturnType<typeof member>) =>
		rt.transport.invokeRoute(name, input, { method: "POST", ...(user ? { user } : {}) } as never) as Promise<Out>;
	const entry = async (collection: string, title: string, status = "published") =>
		(await rt.fixtures.content(collection, { data: { title, ...(collection === "lms_courses" ? { access: "open" } : {}) }, slug: title.toLowerCase().replaceAll(" ", "-"), status } as never)).id as string;
	return { rt, get, post, entry, dispose: () => rt.dispose() };
}

export type Site = Awaited<ReturnType<typeof openSite>>;

/** A published course with an outline of `n` published lessons, in order. */
export async function courseWithOutline(site: Site, n = 3, title = "Course A") {
	const course = await site.entry("lms_courses", title);
	const lessons: Array<{ id: string; title: string }> = [];
	for (let i = 1; i <= n; i += 1) {
		const name = `${title} lesson ${i}`;
		lessons.push({ id: await site.entry("lms_lessons", name), title: name });
	}
	await site.rt.fixtures.plugin.storage("outlines", course, { courseKey: course, courseTitle: title, lessons, updatedAt: "2026-11-15T00:00:00.000Z", rev: "r1" });
	return { course, lessons };
}

export const QUIZ = {
	title: "Check yourself",
	lessonKey: "lesson-1",
	questions: [
		{ type: "choice", prompt: "Pick C", answers: ["A", "B", "C", "D"], correct: 2 },
		{ type: "true_false", prompt: "The sky is blue", correct: 0 },
	],
	updatedAt: "2026-11-15T00:00:00.000Z",
	rev: "q1",
};

/** A quiz stored on a fresh lesson (published unless said), the way the Quizzes page leaves it. */
export async function quizOnLesson(site: Site, id = "q1", status = "published", quiz: Record<string, unknown> = QUIZ) {
	const lesson = await site.entry("lms_lessons", `Lesson for ${id}`, status);
	await site.rt.fixtures.plugin.storage("quizzes", id, { ...quiz, lessonKey: lesson });
	await site.rt.fixtures.plugin.kv(`state:lesson-quiz:${lesson}`, id);
	return lesson;
}
