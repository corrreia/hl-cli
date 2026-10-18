/**
 * Karakeep.
 */
import { bearer, defineService } from "../define.ts";
import versions from "./_generated/versions.ts";

/** Karakeep. */
export const service = defineService({
	id: "karakeep",
	title: "Karakeep",
	basePath: "/api/v1",
	versions,
	auth: bearer,
});
