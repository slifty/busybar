// A block of settings out of the config file, and the only way anything reads
// one.
//
// Values do not travel as a plain object, because two things have to survive
// the trip from the file to whatever cares about the setting.
//
// Where it came from. A value of the wrong type is a mistake in a file
// somebody typed, so the complaint has to name the line to go and fix --
// `programs.focus.calendar must be text` -- rather than surfacing later,
// somewhere that has long since forgotten there was a file involved.
//
// What was never asked for. A section remembers which keys were read, so
// `done` can refuse the rest: a misspelled setting that is quietly ignored is
// a setting that does nothing at all, for as long as it takes somebody to
// notice that the bar is not doing what the file plainly says.

// The count of things in something empty.
const NONE = 0;

// The smallest a setting measuring a length of time can be. Zero is a coherent
// thing to ask for -- no warning at all -- and less than none is not.
const NO_TIME = 0;

interface ConfigSection {
	// Text, or the default when the setting is absent.
	readonly string: (key: string, fallback: string) => string;
	// Text, where being absent means something other than "use the default" --
	// no calendar at all, rather than a particular one.
	readonly optionalString: (key: string) => string | undefined;
	// Several values, written as a YAML list. Absent is an empty list rather
	// than an error, so a setting nobody has written reads as one nothing was
	// asked of.
	//
	// A list rather than a block of named entries because the names would have
	// to be unique and would mean nothing: YAML rejects a repeated key, so
	// naming calendars would cap you at one `work` and one `personal` while
	// buying no behaviour in return. A list takes as many as you have, and a
	// comment groups them for the reader.
	readonly strings: (key: string) => string[];
	// A count of minutes or seconds, or the default when the setting is absent.
	readonly number: (key: string, fallback: number) => number;
	// A count of minutes or seconds that cannot be zero, for the ones where
	// zero would mean "as fast as possible" rather than "not at all".
	readonly positiveNumber: (key: string, fallback: number) => number;
	// A block nested inside this one. Absent is empty rather than an error, so
	// a block nobody has written reads as one where nothing was set.
	readonly section: (key: string) => ConfigSection;
	// Every key written in this block, in the order they were written, counted
	// as read. For a block whose keys are names rather than settings --
	// `programs`, where what is written is which programs to run.
	readonly names: () => string[];
	// Where a setting would be written, for a message about how to fix it.
	readonly where: (key: string) => string;
	// Throws unless every key in this block was read by one of the above.
	readonly done: () => void;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// What a block with nothing written in it holds.
const EMPTY: Record<string, unknown> = {};

// A blank is not a value.
//
// `calendar:` with nothing after it, or with an empty string after it, is far
// more often a line somebody meant to come back and fill in than a deliberate
// request for an empty calendar -- and there is no setting here where the
// empty string is a meaningful answer. Treating it as absent means a
// half-written line falls back to the default rather than configuring
// something nobody asked for.
const BLANK = "";

const createSection = (
	file: string,
	path: string,
	value: unknown,
): ConfigSection => {
	// The path from the top of the file, as somebody would write it: `device`,
	// `programs.focus.calendar`. The top level has no path of its own, so its
	// keys are named on their own.
	const qualify = (key: string): string =>
		path === BLANK ? key : `${path}.${key}`;

	const label = path === BLANK ? "the file" : path;
	const values = value ?? EMPTY;

	if (!isMapping(values)) {
		throw new Error(`${file}: ${label} must be a block of settings`);
	}

	const read = new Set<string>();

	const at = (key: string): unknown => {
		read.add(key);

		// Guarded so that an inherited key like "toString" cannot answer for a
		// setting that was never written.
		if (!Object.hasOwn(values, key)) {
			return undefined;
		}

		const { [key]: found } = values;

		return found;
	};

	const asString = (key: string): string | undefined => {
		const found = at(key);

		// YAML reads a key with nothing after it as null, which is the same
		// nothing as a key that was never written.
		if (found === undefined || found === null) {
			return undefined;
		}

		if (typeof found !== "string") {
			throw new Error(`${file}: ${qualify(key)} must be text`);
		}

		const trimmed = found.trim();

		return trimmed === BLANK ? undefined : trimmed;
	};

	// A list of text, with the half-written entries left out.
	//
	// A blank entry is dropped rather than refused, for the same reason a blank
	// setting falls back: `- ` with nothing after it is a line somebody meant
	// to come back and fill in, not a request for an empty calendar. An entry
	// that holds something other than text is a different matter and is
	// refused, naming the position so there is somewhere to go and look.
	const asStrings = (key: string): string[] => {
		const found = at(key);

		if (found === undefined || found === null) {
			return [];
		}

		if (!Array.isArray(found)) {
			throw new Error(`${file}: ${qualify(key)} must be a list`);
		}

		return found
			.map((entry: unknown, index) => {
				if (entry === undefined || entry === null) {
					return BLANK;
				}

				if (typeof entry !== "string") {
					throw new Error(
						`${file}: ${qualify(key)}[${String(index)}] must be text`,
					);
				}

				return entry.trim();
			})
			.filter((entry) => entry !== BLANK);
	};

	// A number, and only what YAML already decided was one.
	//
	// Every number this file holds is a length of time, so what is refused is
	// what could not be one: text, however numeric it looks, and anything below
	// zero. Taking YAML at its word means `5m` is refused where it was written
	// rather than quietly read as five, which is the failure worth catching --
	// a lead time silently a sixth of what the file plainly says is a meeting
	// missed by twenty-five minutes.
	//
	// Fractions are allowed. Half a minute is a coherent warning to ask for,
	// and there is no arithmetic here that a fraction would spoil.
	const asNumber = (key: string): number | undefined => {
		const found = at(key);

		if (found === undefined || found === null) {
			return undefined;
		}

		if (typeof found !== "number" || !Number.isFinite(found)) {
			throw new Error(`${file}: ${qualify(key)} must be a number`);
		}

		if (found < NO_TIME) {
			throw new Error(`${file}: ${qualify(key)} must not be negative`);
		}

		return found;
	};

	// A length of time that has to be more than none of it.
	//
	// Zero is a coherent answer to most of what this file asks -- no warning at
	// all, no chime at all, an alert that ends the instant it began -- which is
	// why `number` allows it. It is not a coherent answer to how long to wait
	// between two things. A repeat every zero seconds is a repeat with no gap
	// in it: the bar plays a chime, asks to be drawn again in no time at all,
	// and does both as fast as it can manage until somebody stops it.
	const asPositiveNumber = (key: string): number | undefined => {
		const found = asNumber(key);

		if (found === undefined) {
			return undefined;
		}

		if (found <= NO_TIME) {
			throw new Error(`${file}: ${qualify(key)} must be more than zero`);
		}

		return found;
	};

	return {
		string: (key, fallback) => asString(key) ?? fallback,
		optionalString: asString,
		strings: asStrings,
		number: (key, fallback) => asNumber(key) ?? fallback,
		positiveNumber: (key, fallback) => asPositiveNumber(key) ?? fallback,
		section: (key) => createSection(file, qualify(key), at(key)),
		names: () => {
			const keys = Object.keys(values);

			keys.forEach((key) => {
				read.add(key);
			});

			return keys;
		},
		where: (key) => `${qualify(key)} in ${file}`,
		done: () => {
			const unknown = Object.keys(values).filter((key) => !read.has(key));

			if (unknown.length === NONE) {
				return;
			}

			// What the block does take is listed alongside, because the answer
			// to a rejected key is almost always the one next to it in the
			// alphabet. A block that takes nothing at all says so instead:
			// offering an empty list would read as the file being at fault.
			const known = [...read].sort().join(", ");
			const takes =
				read.size === NONE ? "takes no settings" : `takes: ${known}`;

			throw new Error(
				`${file}: no setting called ${unknown.map(qualify).join(", ")} -- ${label} ${takes}`,
			);
		},
	};
};

export { createSection };
export type { ConfigSection };
