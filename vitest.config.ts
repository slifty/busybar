import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/__tests__/**/*.test.ts"],
		passWithNoTests: true,
		coverage: {
			include: ["src/**/*.ts"],
			exclude: ["src/test/**", "src/**/__tests__/**"],
			reporter: ["text", "html", "lcov"],
		},
	},
});
