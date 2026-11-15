import type { RouteEntry, SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import { catalog, completeLesson, courseGraph, enroll, eraseMember, lessonCourses, myCourses, outline, progress, quiz, submitQuiz } from "./learn";
import { handlePanel } from "./panel";
import { mcpTools, toolRoutes } from "./tools";

// Lowest signed-in role (subscriber) has content:read. A member id in the request is never trusted:
// member routes read the host-verified routeCtx.user.
const MEMBER = "content:read";
const ADMIN = "plugins:manage";

const tools: Record<string, RouteEntry> = Object.fromEntries(
	Object.entries(toolRoutes).map(([name, run]) => [name, { permission: ADMIN, methods: ["POST"], handler: async (routeCtx, ctx) => run(routeCtx, ctx) }]),
);

const plugin: SandboxedPlugin = {
	hooks: {
		// schema.org Course with its published lessons in hasPart, on a course page that passes its
		// content to the layout (every create-emdash template does). Same calls as the outline route.
		"page:metadata": { handler: async (event, ctx) => courseGraph(event.page, ctx) },
	},
	routes: {
		health: { public: true, methods: ["GET"], handler: async (_routeCtx, ctx) => ({ ok: true, plugin: ctx.plugin.id, version: ctx.plugin.version }) },
		outline: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => outline(routeCtx, ctx) },
		catalog: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => catalog(routeCtx, ctx) },
		lessonCourses: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => lessonCourses(routeCtx, ctx) },
		progress: { permission: MEMBER, methods: ["GET"], handler: async (routeCtx, ctx) => progress(routeCtx, ctx) },
		myCourses: { permission: MEMBER, methods: ["GET"], handler: async (routeCtx, ctx) => myCourses(routeCtx, ctx) },
		quiz: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => quiz(routeCtx, ctx) },
		enroll: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => enroll(routeCtx, ctx) },
		completeLesson: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => completeLesson(routeCtx, ctx) },
		submitQuiz: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => submitQuiz(routeCtx, ctx) },
		eraseMember: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => eraseMember(routeCtx, ctx) },
		admin: { permission: ADMIN, handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx, routeCtx.user) },
		// Anyone who may edit a lesson sees which courses hold it.
		panel: { permission: "content:edit_own", handler: async (routeCtx, ctx) => handlePanel(routeCtx, ctx) },
		...tools,
	},
	mcp: { tools: mcpTools },
};

export default plugin;
