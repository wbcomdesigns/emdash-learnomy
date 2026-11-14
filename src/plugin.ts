import type { SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";
import { completeLesson, enroll, eraseMember, outline, quiz, submitQuiz } from "./learn";

// Lowest signed-in role (subscriber) has content:read. A member id in the request is never trusted:
// member routes read the host-verified routeCtx.user.
const MEMBER = "content:read";
const ADMIN = "plugins:manage";

const plugin: SandboxedPlugin = {
	routes: {
		health: { public: true, methods: ["GET"], handler: async (_routeCtx, ctx) => ({ ok: true, plugin: ctx.plugin.id, version: ctx.plugin.version }) },
		outline: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => outline(routeCtx, ctx) },
		quiz: { public: true, methods: ["GET"], handler: async (routeCtx, ctx) => quiz(routeCtx, ctx) },
		enroll: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => enroll(routeCtx, ctx) },
		completeLesson: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => completeLesson(routeCtx, ctx) },
		submitQuiz: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => submitQuiz(routeCtx, ctx) },
		eraseMember: { permission: MEMBER, methods: ["POST"], handler: async (routeCtx, ctx) => eraseMember(routeCtx, ctx) },
		admin: { permission: ADMIN, handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx) },
	},
};

export default plugin;
