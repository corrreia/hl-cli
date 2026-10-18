/**
 * Where Seerr (Jellyseerr)'s specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({
		repo: "Fallenbagel/jellyseerr",
		tag: /^v(\d+\.\d+\.\d+)$/,
		paths: ["seerr-api.yml", "overseerr-api.yml"],
	}),
	limit: 40,
	naming: { group: "tag" },
};

export default config;
