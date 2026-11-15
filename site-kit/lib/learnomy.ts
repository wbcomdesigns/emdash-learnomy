/* Helpers shared by the Learnomy pages, on the server and in the browser. */
import { esc } from "./wbcom-kit";

/** The plugin's slug. Every request goes through pluginFetch/callPluginRoute in wbcom-kit.ts. */
export const PLUGIN = "learnomy";

export type Lesson = { id: string; title: string; slug: string };
export type Enrollment = { done: string[]; completedAt: string | null } | null;

/**
 * A course is Open only when its access says "open". A course with no access value (made through the API
 * or before the field existed) is Members, on every screen, the same rule the plugin's routes use.
 */
export const isOpenCourse = (data: { access?: unknown }) => data.access === "open";

export const courseHref = (slug: string) => `/courses/${encodeURIComponent(slug)}`;

/** A certificate's shareable page. The token is the whole secret: 32 hex characters. */
export const certificateHref = (token: string) => `/certificates/${encodeURIComponent(token)}`;

/** A lesson page knows its course from ?course=, because one lesson can sit in several courses. */
export const lessonHref = (lessonSlug: string, courseSlug?: string) =>
	`/lessons/${encodeURIComponent(lessonSlug)}${courseSlug ? `?course=${encodeURIComponent(courseSlug)}` : ""}`;

/** Catalog pages Previous can step back through; older pages fall back to the first page. */
const CATALOG_BACK = 20;

/**
 * Previous and Next for the catalog. EmDash cursors only go forward, so the URL carries the cursors
 * of the pages before this one (`back`, comma-separated: cursors are base64) and Previous pops one.
 */
export function catalogPages(cursor: string | undefined, back: string[], nextCursor: string | undefined) {
	return {
		previous: cursor ? { cursor: back.at(-1), back: back.slice(0, -1).join(",") || undefined } : undefined,
		next: nextCursor ? { cursor: nextCursor, back: (cursor ? [...back, cursor].slice(-CATALOG_BACK) : []).join(",") || undefined } : undefined,
	};
}

/** The first lesson not done yet, in outline order, or the first lesson when all are done. */
export function nextLesson(lessons: Lesson[], done: string[]): Lesson | undefined {
	return lessons.find((lesson) => !done.includes(lesson.id)) ?? lessons[0];
}

/**
 * The member's progress on the lessons this page shows (the course's published outline lessons): the
 * same count the plugin's myCourses route gives, so every screen agrees and never reads "7 of 5".
 * Finished comes from the lessons, not the stored completedAt, so a draft lesson in the outline never
 * holds a course open and a lesson added later reads as one more to do.
 */
export function progressOn(lessons: Lesson[], done: string[]) {
	const count = lessons.filter((lesson) => done.includes(lesson.id)).length;
	return { done: count, total: lessons.length, finished: lessons.length > 0 && count === lessons.length };
}

export const percent = (done: number, total: number) => (total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0);

type Span = { _type?: string; text?: string; marks?: string[] };
type MarkDef = { _key: string; _type: string; href?: string };
type Block = {
	_type: string;
	style?: string;
	listItem?: "bullet" | "number";
	children?: Span[];
	markDefs?: MarkDef[];
	asset?: { url?: string };
	alt?: string;
	caption?: string;
	code?: string;
};

const STYLES: Record<string, string> = { h1: "h2", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6", blockquote: "blockquote", normal: "p" };

function safeHref(href = ""): string | null {
	return /^(https?:|mailto:|\/|#)/i.test(href.trim()) ? href.trim() : null;
}

function spans(block: Block): string {
	const defs = new Map((block.markDefs ?? []).map((def) => [def._key, def]));
	return (block.children ?? [])
		.map((span) => {
			let html = esc(span.text ?? "").replace(/\n/g, "<br>");
			for (const mark of span.marks ?? []) {
				if (mark === "strong") html = `<strong>${html}</strong>`;
				else if (mark === "em") html = `<em>${html}</em>`;
				else if (mark === "code") html = `<code>${html}</code>`;
				else if (mark === "underline") html = `<u>${html}</u>`;
				else if (mark === "strike-through") html = `<s>${html}</s>`;
				else {
					const href = safeHref(defs.get(mark)?.href);
					if (href) html = `<a href="${esc(href)}">${html}</a>`;
				}
			}
			return html;
		})
		.join("");
}

/**
 * Portable Text to HTML for a Members lesson body fetched in the browser. Text, headings, quotes,
 * lists, links, code and images with a URL. Everything is escaped; unknown blocks are skipped.
 * ponytail: embeds and custom blocks are left out; the server-rendered Open lesson shows them all.
 */
export function portableTextToHtml(blocks: unknown): string {
	if (!Array.isArray(blocks)) return "";
	let html = "";
	let list: "ul" | "ol" | null = null;
	for (const block of blocks as Block[]) {
		const wanted = block._type === "block" && block.listItem ? (block.listItem === "number" ? "ol" : "ul") : null;
		if (list && wanted !== list) {
			html += `</${list}>`;
			list = null;
		}
		if (wanted) {
			if (!list) html += `<${wanted}>`;
			list = wanted;
			html += `<li>${spans(block)}</li>`;
		} else if (block._type === "block") {
			const tag = STYLES[block.style ?? "normal"] ?? "p";
			html += `<${tag}>${spans(block)}</${tag}>`;
		} else if (block._type === "image" && safeHref(block.asset?.url)) {
			const caption = block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : "";
			html += `<figure><img src="${esc(block.asset!.url)}" alt="${esc(block.alt ?? "")}" loading="lazy">${caption}</figure>`;
		} else if (block._type === "code" && block.code) {
			html += `<pre><code>${esc(block.code)}</code></pre>`;
		}
	}
	return list ? `${html}</${list}>` : html;
}
