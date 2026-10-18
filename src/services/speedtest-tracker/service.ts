/**
 * Speedtest Tracker.
 */
import { bearer, defineService } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Speedtest Tracker. */
export const service = defineService({
	id: "speedtest-tracker",
	title: "Speedtest Tracker",
	basePath: "",
	versions,
	auth: bearer,
});
