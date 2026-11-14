import type { PluginContext } from "emdash/plugin";

import { asRecord, asString } from "./util";

type Toast = { message: string; type: "success" | "error" | "info" };
export type BlockResponse = { blocks: Array<Record<string, unknown>>; toast?: Toast };

/** Step 3 builds these pages (SCOPE "In scope" item 3). Until then each says what it will hold. */
export async function handleAdmin(input: unknown, _ctx: PluginContext): Promise<BlockResponse> {
	const page = asString(asRecord(input).page);
	if (page === "/quizzes") {
		return { blocks: [{ type: "header", text: "Quizzes" }, { type: "empty", title: "No quizzes yet", description: "Quizzes are written here, one question per form." }] };
	}
	return { blocks: [{ type: "header", text: "Course outline" }, { type: "empty", title: "No outlines yet", description: "Pick a course and add its lessons by title." }] };
}
