// Protobuf messages, written by hand, for the suites that read them.
//
// The device is the only thing that produces these for real, so a test needs
// somewhere to write one from scratch -- and writing the encoder is what makes
// the decoder's tests worth anything. A fixture captured off the wire would
// pass for the wrong reasons the moment either side changed.

const VARINT = 0;
const LENGTH_DELIMITED = 2;

const WIRE_TYPE_BITS = 3;

const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUES = 0x80;
const VARINT_PAYLOAD_BITS = 7;

const NOTHING_MORE = 0;

const varint = (value: number): number[] => {
	const bytes: number[] = [];
	let left = value;

	do {
		const byte = left & VARINT_PAYLOAD_MASK;

		left >>>= VARINT_PAYLOAD_BITS;
		bytes.push(left === NOTHING_MORE ? byte : byte | VARINT_CONTINUES);
	} while (left !== NOTHING_MORE);

	return bytes;
};

const tag = (number: number, wireType: number): number[] =>
	varint((number << WIRE_TYPE_BITS) | wireType);

// A field holding a whole number.
const numberField = (number: number, value: number): number[] => [
	...tag(number, VARINT),
	...varint(value),
];

// A field holding another message.
const messageField = (number: number, body: number[]): number[] => [
	...tag(number, LENGTH_DELIMITED),
	...varint(body.length),
	...body,
];

const bytesOf = (...parts: number[][]): Uint8Array =>
	new Uint8Array(parts.flat());

export { bytesOf, messageField, numberField };
