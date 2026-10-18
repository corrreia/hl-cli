/**
 * Komga.
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Komga. */
export const service = defineService({
	id: "komga",
	title: "Komga",
	basePath: "",
	versions,
	auth: apiKeyHeader("X-API-Key"),
	version: {
		route: "/actuator/info",
		read: (body) => stringAt(body, ["build", "version"]),
	},
});
