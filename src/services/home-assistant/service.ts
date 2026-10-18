/**
 * Home Assistant, with a long-lived access token (your profile → Security).
 */
import { bearer, defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Home Assistant. */
export const service = defineService({
	id: "home-assistant",
	title: "Home Assistant",
	basePath: "/api",
	versions,
	credential: "long-lived access token",
	auth: bearer,
	version: { route: "/config", read: (body) => stringAt(body, ["version"]) },
});
