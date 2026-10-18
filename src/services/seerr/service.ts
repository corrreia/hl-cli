/**
 * Seerr (Jellyseerr).
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Seerr (Jellyseerr). */
export const service = defineService({
	id: "seerr",
	title: "Seerr (Jellyseerr)",
	basePath: "/api/v1",
	versions,
	auth: apiKeyHeader(),
	version: {
		route: "/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
