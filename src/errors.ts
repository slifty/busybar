// Turning a thrown thing into a line of log.
//
// Causes are appended rather than dropped, because the message that explains
// what went wrong is usually the innermost one: "could not read focus.json" is
// only useful next to the ENOENT that prompted it.
//
// Anything can be thrown in JavaScript, so this takes an `unknown` and always
// comes back with something printable.
const describe = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return String(error);
	}

	return error.cause === undefined
		? error.message
		: `${error.message}: ${describe(error.cause)}`;
};

export { describe };
