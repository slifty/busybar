// Text elements only accept printable ASCII, because the fonts are bitmap
// ASCII. Names written by hand will not respect that and calendar titles
// certainly will not -- en dashes, curly quotes and emoji are all ordinary in
// a title -- so anything undrawable is dropped and the surrounding whitespace
// tidied, rather than letting the device reject the draw over a character
// nobody would miss.
//
// This sits on its own because both sources of blocks need it: the schedule
// file and the calendar reader, neither of which should have to import the
// other to get at it.
const UNDRAWABLE = /[^\x20-\x7E]+/gv;
const RUN_OF_SPACES = / {2,}/gv;

const drawableName = (name: string): string =>
	name.replace(UNDRAWABLE, " ").replace(RUN_OF_SPACES, " ").trim();

export { drawableName };
