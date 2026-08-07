import type { BusyBar } from "@busy-app/busy-lib";

// The device rejects a draw with 409 when a higher-priority app owns the
// screen -- most commonly an active BUSY or CUSTOM focus session.
const HTTP_CONFLICT = 409;

// busy-lib rejects with a plain Error carrying `status` from the HTTP
// response, so the status has to be read off an unknown value.
const statusOf = (error: unknown): number | undefined => {
	if (error instanceof Error && "status" in error) {
		const { status } = error;

		return typeof status === "number" ? status : undefined;
	}

	return undefined;
};

const isPreempted = (error: unknown): boolean =>
	statusOf(error) === HTTP_CONFLICT;

// Removes one application's elements, leaving anything drawn by other
// applications in place.
const clearApplication = async (
	bar: BusyBar,
	applicationName: string,
): Promise<void> => {
	await bar.DisplayClear({ application_name: applicationName });
};

export { clearApplication, isPreempted };
