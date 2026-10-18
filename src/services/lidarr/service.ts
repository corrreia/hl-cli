/**
 * Lidarr.
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Lidarr. */
export const service = defineService({
	id: "lidarr",
	title: "Lidarr",
	basePath: "",
	versions,
	auth: apiKeyHeader(),
	version: {
		route: "/api/v1/system/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
