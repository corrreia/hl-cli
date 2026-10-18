/**
 * authentik.
 */
import { bearer, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** authentik. */
export const service = defineService({
	id: "authentik",
	title: "authentik",
	basePath: "/api/v3",
	versions,
	auth: bearer,
	credential: "API token",
	version: {
		route: "/admin/version/",
		read: (body) => stringAt(body, ["version_current"]),
	},
});
