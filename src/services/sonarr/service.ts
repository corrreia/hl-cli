/**
 * Sonarr.
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Sonarr. */
export const service = defineService({
	id: "sonarr",
	title: "Sonarr",
	basePath: "",
	versions,
	auth: apiKeyHeader(),
	version: {
		route: "/api/v3/system/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
