import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [emdashPluginTest()],
	// One file at a time: each file's sandbox setup rebuilds the plugin into dist/ (listora saw a
	// half-written dist/manifest.json when two files built together).
	test: { setupFiles: ["./tests/block-check.ts"], testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
