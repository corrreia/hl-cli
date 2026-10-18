/**
 * Where Prowlarr's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({
		repo: "Prowlarr/Prowlarr",
		tag: /^v(\d+\.\d+\.\d+\.\d+)$/,
		paths: ["src/Prowlarr.Api.V1/openapi.json"],
	}),
	limit: 40,
	naming: { group: "tag", prefix: /^\/api\/v1/ },
	exclude: [/^\/(?!api\/)/],
};

export default config;
