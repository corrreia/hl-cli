/**
 * Jellyfin.
 */
import { defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Jellyfin. */
export const service = defineService({
	id: "jellyfin",
	title: "Jellyfin",
	basePath: "",
	versions,
	auth: (apiKey) => ({ Authorization: `MediaBrowser Token="${apiKey}"`, Accept: "application/json" }),
	version: {
		route: "/System/Info/Public",
		read: (body) => stringAt(body, ["Version"]),
	},
});
