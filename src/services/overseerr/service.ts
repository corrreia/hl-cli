/**
 * Overseerr.
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Overseerr. */
export const service = defineService({
	id: "overseerr",
	title: "Overseerr",
	basePath: "/api/v1",
	versions,
	auth: apiKeyHeader(),
	version: {
		route: "/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
