/**
 * Radarr.
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Radarr. */
export const service = defineService({
	id: "radarr",
	title: "Radarr",
	basePath: "",
	versions,
	auth: apiKeyHeader(),
	version: {
		route: "/api/v3/system/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
