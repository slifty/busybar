// Just enough of the protobuf wire format to find one field in one message.
//
// The bar streams its state as protobuf over a WebSocket, and `busy-lib` does
// decode it -- inside a SharedWorker, which is browser-only. The schema ships
// in the package but is reachable only from that worker, and the part of it
// this tool wants is four fields down one branch: which button was pressed.
//
// So this reads the wire format rather than taking on a protobuf runtime and a
// copy of a schema that would then have to be kept in step with the firmware.
// The format carries enough of itself to allow that: every field announces its
// number and how it is encoded, so a field this has never heard of is skipped
// on the strength of the encoding alone. That is the property being relied on
// -- the firmware can add whatever it likes to the message, and this still
// finds field 11 afterwards.

// The low three bits of a field's tag say how the value is encoded; the rest
// is the field number.
const WIRE_TYPE_BITS = 3n;
const WIRE_TYPE_MASK = 7n;

const VARINT = 0;
const FIXED_64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED_32 = 5;

const FIXED_64_BYTES = 8;
const FIXED_32_BYTES = 4;

// A varint carries seven bits of value per byte, and the top bit says whether
// another byte follows.
const VARINT_PAYLOAD_BITS = 7n;
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUES = 0x80;

const NOTHING_MORE = 0;

// One step along the message.
const NEXT_BYTE = 1;

// One field as it was written, before anything decides what it means.
type FieldValue = bigint | Uint8Array;

type Fields = ReadonlyMap<number, readonly FieldValue[]>;

// Where a read got to, alongside what it read. Returned as a pair rather than
// carried on a cursor object because every reader here is one call deep.
interface Read<T> {
	readonly value: T;
	readonly next: number;
}

const readVarint = (bytes: Uint8Array, from: number): Read<bigint> => {
	let value = 0n;
	let shift = 0n;
	let at = from;

	for (;;) {
		const byte = bytes.at(at);

		if (byte === undefined) {
			throw new Error("a varint ran off the end of the message");
		}

		at += NEXT_BYTE;
		value |= BigInt(byte & VARINT_PAYLOAD_MASK) << shift;

		if ((byte & VARINT_CONTINUES) === NOTHING_MORE) {
			return { value, next: at };
		}

		shift += VARINT_PAYLOAD_BITS;
	}
};

const readBytes = (
	bytes: Uint8Array,
	from: number,
	length: number,
): Read<Uint8Array> => {
	const end = from + length;

	if (end > bytes.length) {
		throw new Error("a field ran off the end of the message");
	}

	return { value: bytes.subarray(from, end), next: end };
};

const readValue = (
	bytes: Uint8Array,
	from: number,
	wireType: number,
): Read<FieldValue> => {
	if (wireType === VARINT) {
		return readVarint(bytes, from);
	}

	if (wireType === LENGTH_DELIMITED) {
		const { value: length, next } = readVarint(bytes, from);

		return readBytes(bytes, next, Number(length));
	}

	if (wireType === FIXED_64) {
		return readBytes(bytes, from, FIXED_64_BYTES);
	}

	if (wireType === FIXED_32) {
		return readBytes(bytes, from, FIXED_32_BYTES);
	}

	// Groups, removed from the language long before this device existed. There
	// is nothing sensible to skip, since a group's end is another tag rather
	// than a length, so the message is refused instead of half-read.
	throw new Error(`unsupported protobuf wire type ${String(wireType)}`);
};

// Every field in a message, by number.
//
// Repeated fields keep all of their values, and so does a field that was
// written more than once without being repeated -- the format allows it, and
// deciding which one wins is the caller's business rather than this one's.
const fieldsOf = (bytes: Uint8Array): Fields => {
	const fields = new Map<number, FieldValue[]>();
	let at = 0;

	while (at < bytes.length) {
		const { value: tag, next } = readVarint(bytes, at);
		const number = Number(tag >> WIRE_TYPE_BITS);
		const wireType = Number(tag & WIRE_TYPE_MASK);
		const { value, next: after } = readValue(bytes, next, wireType);

		fields.set(number, [...(fields.get(number) ?? []), value]);
		at = after;
	}

	return fields;
};

// The submessages written at a field number, in the order they were written.
//
// Anything at that number encoded some other way is not a submessage and is
// left out rather than refused: this is reading one branch of a message the
// firmware owns, and being strict about the branches it is not reading would
// turn every unrelated change upstream into a failure here.
const messagesAt = (fields: Fields, number: number): Uint8Array[] =>
	(fields.get(number) ?? []).filter((value) => value instanceof Uint8Array);

// The first submessage at a field number, if there is one.
const messageAt = (fields: Fields, number: number): Uint8Array | undefined => {
	const [first] = messagesAt(fields, number);

	return first;
};

// The number written at a field number.
//
// Undefined when the field is absent, which in proto3 is also how a zero is
// written: a field holding the first value of its enum is left off the wire
// entirely. Every caller here therefore has to say what absence means, and
// for an enum the answer is its zero -- which is why this hands back undefined
// rather than quietly answering zero itself.
const numberAt = (fields: Fields, number: number): number | undefined => {
	const [first] = fields.get(number) ?? [];

	return typeof first === "bigint" ? Number(first) : undefined;
};

export { fieldsOf, messageAt, messagesAt, numberAt };
export type { Fields };
