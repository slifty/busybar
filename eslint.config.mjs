import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import love from "eslint-config-love";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default defineConfig([
	js.configs.recommended,
	tseslint.configs.eslintRecommended,
	tseslint.configs.recommendedTypeChecked,
	tseslint.configs.strict,
	{
		...love,
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.dev.json",
			},
		},
	},
	prettier,
	{
		languageOptions: {
			globals: {
				...globals.node,
			},

			parserOptions: {
				project: "./tsconfig.dev.json",
			},
		},

		rules: {
			"@typescript-eslint/no-magic-numbers": [
				"error",
				{
					detectObjects: false,
					ignoreEnums: true,
				},
			],

			// Unlike some code bases we explicitly do not want to use default exports.
			"import/prefer-default-export": "off",
			"import/no-default-export": "error",

			"import/order": [
				"error",
				{
					groups: [
						"builtin",
						"external",
						"internal",
						"parent",
						"sibling",
						"index",
						"object",
						"type",
					],
					"newlines-between": "never",
				},
			],

			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					caughtErrors: "none",
				},
			],
		},
		settings: {
			"import/resolver": {
				typescript: {
					alwaysTryTypes: true,
					project: "./tsconfig.dev.json",
				},
				node: true,
			},
		},
	},
	{
		files: ["**/*.test.ts"],

		rules: {
			// Forcing return type definitions in our ad-hoc test functions is not worth
			// the added effort / verbosity.
			"@typescript-eslint/explicit-function-return-type": "off",

			// Tests use hard coded numbers in lots of places, and that's OK.
			"@typescript-eslint/no-magic-numbers": "off",
		},
	},
]);
