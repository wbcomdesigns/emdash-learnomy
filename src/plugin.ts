import type { RouteEntry, SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import { catalog, completeLesson, courseGraph, enroll, eraseMember, lessonCourses, memberQuiz, myCourses, outline, progress, quiz, submitQuiz } from "./learn";
import { certificate, myCertificates, setCertificate } from "./lib/certificates";
import { BAD_INPUT, fail, parse } from "./lib/common";
import { handlePanel } from "./panel";
import { setCertificateInput } from "./schemas";
import { DAILY, daily, setUp } from "./tasks";
import { mcpTools, toolRoutes } from "./tools";

// Lowest signed-in role (subscriber) has content:read. A member id in the request is never trusted:
// member routes read the host-verified routeCtx.user.
const MEMBER = "content:read";
const ADMIN = "plugins:manage";
const SIGN_IN = fail("SIGN_IN_REQUIRED", "Sign in to continue.");

const tools: Record<string, RouteEntry> = Object.fromEntries(
	Object.entries(toolRoutes).map(([name, run]) => [name, { permission: ADMIN, methods: ["POST"], handler: async (routeCtx, ctx) => run(routeCtx, ctx) }]),
);

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": { handler: async (_event, ctx) => setUp(ctx) },
		"plugin:activate": { handler: async (_event, ctx) => setUp(ctx) },
		cron: {
			handler: async (event, ctx) => {
				if (event.name === DAILY) await daily(ctx);
			},
		},
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
		memberQuiz: { permission: MEMBER, methods: ["GET"], handler: async (routeCtx, ctx) => memberQuiz(routeCtx, ctx) },
		enroll: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => enroll(routeCtx, ctx) },
		completeLesson: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => completeLesson(routeCtx, ctx) },
		submitQuiz: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => submitQuiz(routeCtx, ctx) },
		// 0.3.0 certificates. The public route answers only name, course, date and site for a link that is on.
		certificate: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => certificate(routeCtx.input, ctx) },
		myCertificates: { permission: MEMBER, methods: ["GET"], handler: async (routeCtx, ctx) => (routeCtx.user ? myCertificates(routeCtx.user.id, ctx) : SIGN_IN) },
		setCertificate: {
			permission: MEMBER,
			methods: ["POST"],
			handler: async (routeCtx, ctx) => {
				if (!routeCtx.user) return SIGN_IN;
				const input = parse(setCertificateInput, routeCtx.input);
				return input ? setCertificate(routeCtx.user.id, input.course, input.on, ctx) : BAD_INPUT;
			},
		},
		eraseMember: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => eraseMember(routeCtx, ctx) },
		admin: { permission: ADMIN, handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx, routeCtx.user) },
		// Anyone who may edit a lesson sees which courses hold it.
		panel: { permission: "content:edit_own", handler: async (routeCtx, ctx) => handlePanel(routeCtx, ctx) },
		...tools,
	},
	mcp: { tools: mcpTools },
};

export default plugin;
