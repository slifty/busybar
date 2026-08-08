// Universal time constants.
//
// Nothing here is specific to the BUSY Bar or to any one program -- these are
// the plain unit conversions that would otherwise show up as bare numbers at
// every call site.

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

export { MS_PER_MINUTE, MS_PER_SECOND, SECONDS_PER_MINUTE };
