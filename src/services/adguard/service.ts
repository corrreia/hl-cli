/**
 * AdGuard Home.
 */
import { defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

/** AdGuard Home. */
export const service = defineService({
	id: "adguard",
	title: "AdGuard Home",
	basePath: "/control",
	versions,
	auth: (credential) => ({
		Authorization: `Basic ${Buffer.from(credential).toString("base64")}`,
		Accept: "application/json",
	}),
	credential: "user:password",
	version: {
		route: "/status",
		read: (body) => stringAt(body, ["version"]),
	},
});
