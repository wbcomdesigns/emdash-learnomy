import type { Ctx } from "./lib/common";

/**
 * Bumped when a release adds work for the daily task (reminders, notices). EmDash runs no hook when a
 * plugin is updated (registry or file), so the daily task, which every version schedules, compares
 * this with the marker in kv and runs the new work once. 0.1.0 has none yet: it only records itself.
 */
export const TASKS = "0.1.0";
export const MARKER = "state:tasks";
export const DAILY = "daily";

/**
 * Install and activate: schedule the daily task and record the marker only when none is there yet
 * (a later version's marker is never moved back). Two or three calls. Since EmDash 1.5 a throw here
 * disables the plugin, so a failure is logged and the routes keep working.
 */
export async function setUp(ctx: Ctx): Promise<void> {
	try {
		await ctx.cron?.schedule(DAILY, { schedule: "17 4 * * *" });
		if ((await ctx.kv.get(MARKER)) == null) await ctx.kv.set(MARKER, TASKS);
	} catch (error) {
		ctx.log.error("Learnomy could not schedule its daily task. Deactivate and activate it again.", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** The daily run: one call while the marker is current, two when a newer version runs for the first time. */
export async function daily(ctx: Ctx): Promise<void> {
	if ((await ctx.kv.get(MARKER)) === TASKS) return;
	// Work a later release adds goes here, before the marker moves.
	await ctx.kv.set(MARKER, TASKS);
}
