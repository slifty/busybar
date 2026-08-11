// What the tool can be told to do, as opposed to what the device is.
//
// Facts about the hardware live in `src/constants/device.ts`: the size of the
// displays and the way the firmware arbitrates draws are nobody's choice, and
// keeping them here invited them to be read as settings.

// Environment variable naming the programs to run: one name, or several
// separated by PROGRAM_SEPARATOR.
const PROGRAM_ENV_VAR = "BUSYBAR_PROGRAM";

// What separates one program's name from the next in that variable.
const PROGRAM_SEPARATOR = ",";

export { PROGRAM_ENV_VAR, PROGRAM_SEPARATOR };
