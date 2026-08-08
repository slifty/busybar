// The emoji the BUSY Bar already knows how to draw.
//
// Emoji cannot be drawn as text. The device's fonts are bitmap ASCII, and the
// HTTP API enforces that: a text element's content must match ^[\x20-\x7E]+$,
// so anything outside printable ASCII is rejected outright.
//
// The firmware does ship emoji as images, though, under
// /ext/apps_assets/shared/images. Those are addressed with `stock_path` rather
// than `path`, which means there is nothing to upload -- no asset management,
// no image encoding, no bundled files. The list below is every dt_emoji_*
// sprite present in firmware, spelling included (`laught` and `tounge` are the
// device's own).

const EMOJI_NAMES = [
	"angry",
	"awkward",
	"cry",
	"dead",
	"evil",
	"expressionless",
	"eyes",
	"fatigue",
	"glasses",
	"grinning",
	"happy",
	"heart_eyes",
	"laught",
	"melted",
	"panic",
	"relief",
	"sad",
	"sleep",
	"surprised",
	"sweat_smile",
	"tounge",
] as const;

type EmojiName = (typeof EMOJI_NAMES)[number];

// Stock assets are referenced relative to the shared asset directory.
const stockPathFor = (name: EmojiName): string =>
	`shared/dt_emoji_${name}.image`;

const randomEmojiName = (): EmojiName => {
	const [fallback] = EMOJI_NAMES;
	const index = Math.floor(Math.random() * EMOJI_NAMES.length);

	// The index is always in range, but `noUncheckedIndexedAccess` cannot see
	// that through a computed lookup, so the tuple's head stands in.
	return EMOJI_NAMES[index] ?? fallback;
};

export { EMOJI_NAMES, randomEmojiName, stockPathFor };
export type { EmojiName };
