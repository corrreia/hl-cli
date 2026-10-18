/**
 * Where Radarr's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "Radarr/Radarr", tag: /^v(\d+\.\d+\.\d+\.\d+)$/, paths: ["src/Radarr.Api.V3/openapi.json"] }),
	limit: 40,
	naming: { group: "tag", prefix: /^\/api\/v3/ },
	exclude: [/^\/(?!api\/)/],
};

export default config;
