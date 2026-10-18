/**
 * Frigate.
 */
import { bearer, defineService } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Frigate. */
export const service = defineService({
	id: "frigate",
	title: "Frigate",
	basePath: "/api",
	versions,
	auth: bearer,
	credential: "JWT token",
	authOptional: true,
	version: {
		route: "/version",
		read: (body) => (typeof body === "string" ? body.trim().split("-")[0] : undefined),
	},
});
