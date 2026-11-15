import { afterEach, describe, expect, it } from "vitest";

import plugin from "../src/plugin";
import { MARKER, TASKS } from "../src/tasks";
import { openSite, type Site } from "./site";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;
const hook = (name: string) => (plugin.hooks as Record<string, { handler: Handler }>)[name]!.handler;

let site: Site | undefined;
afterEach(async () => {
	await site?.dispose();
	site = undefined;
});

describe("daily task and version marker", () => {
	it("install schedules the daily task and records the marker", async () => {
		site = await openSite();
		await site.rt.transport.invokeHook("plugin:install", {});
		const tasks = await site.rt.inspect.scheduledTasks();
		expect(tasks.find((t) => t.name === "daily")?.schedule).toBe("17 4 * * *");
		expect(await site.rt.inspect.kv.get(MARKER)).toBe(TASKS);
	});

	it("activate never moves a newer marker back; the daily run brings an older one up to date", async () => {
		site = await openSite();
		await site.rt.fixtures.plugin.kv(MARKER, "9.9.9");
		await site.rt.transport.invokeHook("plugin:activate", {});
		expect(await site.rt.inspect.kv.get(MARKER)).toBe("9.9.9");
		await site.rt.fixtures.plugin.kv(MARKER, "0.0.1");
		await site.rt.transport.invokeHook("cron", { name: "daily" });
		expect(await site.rt.inspect.kv.get(MARKER)).toBe(TASKS);
	});

	for (const name of ["plugin:install", "plugin:activate"]) {
		it(`${name} logs a scheduler failure instead of throwing (EmDash 1.5 disables a plugin whose activate throws)`, async () => {
			const logged: string[] = [];
			const ctx = {
				cron: { schedule: async () => Promise.reject(new Error("scheduler unavailable")) },
				kv: { get: async () => null, set: async () => undefined },
				log: { error: (message: string) => logged.push(message), info() {}, warn() {} },
			};
			await expect(hook(name)({}, ctx)).resolves.toBeUndefined();
			expect(logged).toEqual(["Learnomy could not schedule its daily task. Deactivate and activate it again."]);
		});
	}
});
