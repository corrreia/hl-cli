/**
 * Grafana.
 */
import { bearer, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Grafana. */
export const service = defineService({
	id: "grafana",
	title: "Grafana",
	basePath: "/api",
	versions,
	auth: bearer,
	credential: "service account token",
	version: {
		route: "/health",
		read: (body) => stringAt(body, ["version"]),
	},
});
