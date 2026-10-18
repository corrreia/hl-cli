/**
 * Audiobookshelf.
 */
import { bearer, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Audiobookshelf. */
export const service = defineService({
	id: "audiobookshelf",
	title: "Audiobookshelf",
	basePath: "",
	versions,
	auth: bearer,
	version: {
		route: "/status",
		read: (body) => stringAt(body, ["serverVersion"]),
	},
});
