import type { SandboxedPlugin } from "emdash/plugin";

import { handleAdmin } from "./admin";

const ADMIN = "plugins:manage";

const plugin: SandboxedPlugin = {
	routes: {
		health: { public: true, methods: ["GET"], handler: async (_routeCtx, ctx) => ({ ok: true, plugin: ctx.plugin.id, version: ctx.plugin.version }) },
		admin: { permission: ADMIN, handler: async (routeCtx, ctx) => handleAdmin(routeCtx.input, ctx) },
	},
};

export default plugin;
