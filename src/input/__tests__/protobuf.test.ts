import { describe, expect, it } from "vitest";
import { bytesOf, messageField, numberField } from "../../test/protobuf.ts";
import { fieldsOf, messageAt, messagesAt, numberAt } from "../protobuf.ts";

describe("fieldsOf", () => {
	it("reads a whole number", () => {
		expect(numberAt(fieldsOf(bytesOf(numberField(1, 7))), 1)).toBe(7);
	});

	// Two bytes on the wire, which is where a reader that stopped at the first
	// byte would report 44 rather than 300.
	it("reads a number too big for one byte", () => {
		expect(numberAt(fieldsOf(bytesOf(numberField(1, 300))), 1)).toBe(300);
	});

	it("reads a field number past the first byte of the tag", () => {
		expect(numberAt(fieldsOf(bytesOf(numberField(11, 2))), 11)).toBe(2);
	});

	it("reads a submessage", () => {
		const message = bytesOf(messageField(2, numberField(1, 5)));
		const inner = messageAt(fieldsOf(message), 2);

		expect(inner).toBeDefined();
		expect(numberAt(fieldsOf(inner ?? new Uint8Array()), 1)).toBe(5);
	});

	it("keeps every value of a repeated field, in order", () => {
		const message = bytesOf(
			messageField(2, numberField(1, 1)),
			messageField(2, numberField(1, 2)),
		);

		const values = messagesAt(fieldsOf(message), 2).map((bytes) =>
			numberAt(fieldsOf(bytes), 1),
		);

		expect(values).toStrictEqual([1, 2]);
	});

	// The property the whole approach rests on: the firmware can add whatever
	// it likes to a message and this still finds the field it came for.
	it("walks past a field it has never heard of", () => {
		const message = bytesOf(
			numberField(3, 9),
			messageField(7, numberField(1, 1)),
			numberField(11, 4),
		);

		expect(numberAt(fieldsOf(message), 11)).toBe(4);
	});

	it("is nothing at all for a message with nothing in it", () => {
		expect(fieldsOf(new Uint8Array()).size).toBe(0);
	});

	// A field that is absent and a field holding zero are the same thing on the
	// wire, so every caller has to say what absence means rather than being
	// handed a zero that might be either.
	it("reports a field that is not there as undefined", () => {
		expect(numberAt(fieldsOf(bytesOf(numberField(1, 1))), 2)).toBeUndefined();
	});

	it("refuses a message that stops in the middle of a field", () => {
		const complete = bytesOf(messageField(1, numberField(1, 1)));

		expect(() => fieldsOf(complete.subarray(0, complete.length - 1))).toThrow(
			/ran off the end/v,
		);
	});

	// Groups were removed from the language long before this device existed,
	// and there is no length to skip past -- so the message is refused rather
	// than half-read.
	it("refuses a wire type it cannot skip", () => {
		expect(() => fieldsOf(new Uint8Array([0x0b]))).toThrow(
			/unsupported protobuf wire type/v,
		);
	});
});
