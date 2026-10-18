/**
 * Immich.
 */
import { apiKeyHeader, defineService, numberAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Immich. */
export const service = defineService({
	id: "immich",
	title: "Immich",
	basePath: "/api",
	versions,
	auth: apiKeyHeader("x-api-key"),
	version: {
		route: "/server/version",
		read: (body) => {
			const parts = ["major", "minor", "patch"].map((key) => numberAt(body, key));
			return parts.every((part) => part !== undefined) ? parts.join(".") : undefined;
		},
	},
});
