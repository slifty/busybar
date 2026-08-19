import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_CONFIG_FILE } from "../../test/config.ts";
import { RETRY_DELAYS_MS, isFetchable, readCalendarSource } from "../source.ts";

describe("isFetchable", () => {
	it.each(["http://example.test/basic.ics", "https://example.test/basic.ics"])(
		"fetches %s",
		(source) => {
			expect(isFetchable(source)).toBe(true);
		},
	);

	// Told apart by parsing the source as a URL rather than by looking for a
	// slash or a dot, so a relative path with either in it stays a path.
	it.each([
		"local/focus.ics",
		"/absolute/focus.ics",
		"./focus.ics",
		"focus.ics",
		"file:///tmp/focus.ics",
	])("opens %s", (source) => {
		expect(isFetchable(source)).toBe(false);
	});
});

// A calendar served over HTTP is asked again when the answer suggests asking
// again would help. The waits between those attempts are run through rather
// than sat out, so the suite costs milliseconds rather than the four minutes
// the real schedule spans.
describe("readCalendarSource, over HTTP", () => {
	const SOURCE = "https://example.test/basic.ics";
	const SETTING = `calendars in ${TEST_CONFIG_FILE}`;
	const CALENDAR = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

	// Answers with each of these in turn, and with the last one for every
	// attempt after them. Reports how many times it was asked.
	const givenFeed = (...answers: Array<Response | Error>): (() => number) => {
		let asked = 0;

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const { [Math.min(asked, answers.length - 1)]: answer } = answers;

				asked += 1;

				if (answer instanceof Error) {
					return await Promise.reject(answer);
				}

				return await Promise.resolve(answer);
			}),
		);

		return () => asked;
	};

	// The assertion is attached before the clock is run, so the rejection a
	// failing read produces is never left unhandled while the timers play out.
	const through = async (asserted: Promise<unknown>): Promise<void> => {
		await vi.runAllTimersAsync();
		await asserted;
	};

	const reading = async (): Promise<string> =>
		await readCalendarSource(SOURCE, SETTING);

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout"] });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("reads a feed that answers first time, without waiting", async () => {
		const asked = givenFeed(new Response(CALENDAR));

		await through(expect(reading()).resolves.toBe(CALENDAR));

		expect(asked()).toBe(1);
	});

	// The failure this exists for: Google's iCalendar export answering 500 to a
	// request it served happily a minute earlier.
	it("asks again when the server says it went wrong, and takes the answer", async () => {
		givenFeed(new Response("nope", { status: 500 }), new Response(CALENDAR));

		await through(expect(reading()).resolves.toBe(CALENDAR));
	});

	it("asks again when nothing arrived at all", async () => {
		givenFeed(new Error("offline"), new Response(CALENDAR));

		await through(expect(reading()).resolves.toBe(CALENDAR));
	});

	// A wrong address, or a key that has been rotated. It will say the same
	// thing however many times it is asked, and asking only delays the message
	// that would have somebody go and fix it.
	it("does not ask again when the request itself was wrong", async () => {
		const asked = givenFeed(new Response("nope", { status: 404 }));

		await through(expect(reading()).rejects.toThrow(/answered 404/v));

		expect(asked()).toBe(1);
	});

	it("gives up once the waits have run out, saying what it last got", async () => {
		const asked = givenFeed(new Response("nope", { status: 503 }));

		await through(expect(reading()).rejects.toThrow(/answered 503/v));

		expect(asked()).toBe(RETRY_DELAYS_MS.length + 1);
	});

	it("gives up on a feed it could never reach, saying so", async () => {
		givenFeed(new Error("offline"));

		await through(expect(reading()).rejects.toThrow(/could not fetch/v));
	});

	// Growing, and never past two minutes: a feed that is still failing after a
	// minute is having a worse day than a blip, and asking it every fifteen
	// seconds is neither kind nor useful.
	it("waits longer each time, up to two minutes", () => {
		expect(RETRY_DELAYS_MS).toStrictEqual([15_000, 30_000, 60_000, 120_000]);
	});
});
