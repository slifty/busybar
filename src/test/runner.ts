import { vi } from "vitest";
import { runPrograms } from "../runner.ts";
import { configOf } from "./config.ts";
import type { FakeBar } from "./bar.ts";
import type { Config } from "../config/index.ts";
import type { DrawResult, Program } from "../program.ts";

// The tooling two suites need to watch the runner work: a program that really
// draws, a way to start and stop a run, and a way to ask what ended up on
// screen and in the log.

const STUB_PROGRAM_NAME = "test-program";
const OTHER_STUB_PROGRAM_NAME = "other-test-program";

const STUB_ELEMENT_ID = "stub";

interface StubOptions {
	readonly name?: string;
	readonly priority?: number;
	readonly onDraw?: (attempt: number) => Promise<DrawResult>;
	readonly start?: Program["start"];
}

// A program that really draws, because half of what the runner does is decide
// what is on screen and in what order. A stub that only returned a result
// would leave every ordering question -- did the failure come down before the
// retry? -- untestable.
//
// Its element is named after the program, so a test running two of these can
// tell which of them drew what.
const stubProgram = ({
	name = STUB_PROGRAM_NAME,
	priority,
	onDraw = async () => await Promise.resolve({}),
	start,
}: StubOptions = {}): Program => {
	let attempts = 0;

	return {
		name,
		description: "a program that exists to be run",
		priority,
		start,
		draw: async (context) => {
			attempts += 1;

			const result = await onDraw(attempts);

			await context.bar.DisplayDraw({
				application_name: context.applicationName,
				priority: context.priority,
				elements: [
					{
						id: `${STUB_ELEMENT_ID}-${context.applicationName}`,
						type: "text",
						text: "stub",
						font: "tiny",
						color: "#FFFFFFFF",
						display: "front",
						align: "center",
						x: 0,
						y: 0,
						timeout: 0,
					},
				],
			});

			return result;
		},
	};
};

interface Run {
	readonly logs: string[];
	readonly finished: Promise<void>;
}

// Starts the runner without waiting for it: it runs until interrupted, so a
// test drives it forward with the clock and then stops it.
//
// Programs get an empty block of settings unless a suite says otherwise, which
// is what a program nobody has configured is handed for real.
const startRun = (fake: FakeBar, ...programs: Program[]): Run =>
	startConfiguredRun(fake, configOf(), ...programs);

const startConfiguredRun = (
	fake: FakeBar,
	config: Config,
	...programs: Program[]
): Run => {
	const logs: string[] = [];

	const finished = runPrograms(fake.bar, programs, config, (message) => {
		logs.push(message);
	});

	return { logs, finished };
};

// Lets everything already scheduled settle, including the first draw.
const settle = async (): Promise<void> => {
	await vi.advanceTimersByTimeAsync(0);
};

const stopRun = async ({ finished }: Run): Promise<void> => {
	process.emit("SIGINT");

	await finished;
};

const programDraws = (
	{ draws }: FakeBar,
	name: string = STUB_PROGRAM_NAME,
): unknown[] =>
	draws.filter(({ elements }) =>
		elements.some((element) => element.id === `${STUB_ELEMENT_ID}-${name}`),
	);

// A failure is drawn as one element per line, numbered, so what identifies it
// is the prefix rather than any single id.
const errorDraws = (
	{ draws }: FakeBar,
	name: string = STUB_PROGRAM_NAME,
): unknown[] =>
	draws.filter(
		({ application_name: application, elements }) =>
			application === name &&
			elements.some((element) => element.id.startsWith("error")),
	);

// `DisplayClear` takes its parameters optionally -- clearing everything is a
// call with nothing in it -- so a recorded clear may have no name at all.
const clearsOf = ({ clears }: FakeBar, name: string): unknown[] =>
	clears.filter((clear) => clear?.application_name === name);

// Every line one program logged, with the name it was tagged with taken back
// off, so that a test says what was reported rather than how it was labelled.
const logsFrom = ({ logs }: Run, name: string = STUB_PROGRAM_NAME): string[] =>
	logs
		.filter((line) => line.startsWith(`${name}: `))
		.map((line) => line.slice(`${name}: `.length));

export {
	OTHER_STUB_PROGRAM_NAME,
	STUB_PROGRAM_NAME,
	clearsOf,
	errorDraws,
	logsFrom,
	programDraws,
	settle,
	startConfiguredRun,
	startRun,
	stopRun,
	stubProgram,
};
export type { Run };
