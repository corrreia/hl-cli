/**
 * Portainer CE, with an access token (My account → Access tokens).
 */
import { apiKeyHeader, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Portainer CE. */
export const service = defineService({
	id: "portainer",
	title: "Portainer CE",
	basePath: "/api",
	versions,
	credential: "access token",
	auth: apiKeyHeader("X-API-Key"),
	version: { route: "/system/status", read: (body) => stringAt(body, ["Version"]) },
});
