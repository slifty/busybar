import biffud from "@biffud/eslint-config";

export default [
	...biffud,
	{
		// Rules the code does not pass yet. Each comes out of this block in a
		// commit of its own, alongside whatever it took to satisfy it.
		rules: {
			"@typescript-eslint/naming-convention": "off",
			"no-magic-numbers": "off",
		},
	},
	{
		files: ["src/fonts.ts"],

		rules: {
			// The font tables are measurements of the device, one number per
			// glyph. There is no name to give any of them that says more than
			// the position in the table already does.
			"no-magic-numbers": "off",
		},
	},
	{
		files: ["**/*.test.ts", "**/__tests__/**", "src/test/**"],

		rules: {
			// Forcing return type definitions in our ad-hoc test functions is not worth
			// the added effort / verbosity.
			"@typescript-eslint/explicit-function-return-type": "off",

			// Tests use hard coded numbers in lots of places, and that's OK.
			"no-magic-numbers": "off",

			// Nesting a `describe` inside a `describe` inside an `it` is how a
			// suite is grouped, not a sign of a tangle.
			"max-nested-callbacks": "off",
		},
	},
];
