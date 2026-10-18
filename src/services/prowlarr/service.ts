/**
 * Prowlarr.
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Prowlarr. */
export const service = defineService({
	id: "prowlarr",
	title: "Prowlarr",
	basePath: "",
	versions,
	auth: apiKeyHeader(),
	version: {
		route: "/api/v1/system/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
