/**
 * Kavita.
 */
import { apiKeyHeader, defineService } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Kavita. */
export const service = defineService({
	id: "kavita",
	title: "Kavita",
	basePath: "",
	versions,
	auth: apiKeyHeader("x-api-key"),
	version: {
		route: "/api/Plugin/version",
		read: (body) => (typeof body === "string" ? body.replace(/"/g, "").trim() || undefined : undefined),
	},
});
