/**
 * Where Sonarr's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	// The repository also carries Radarr's release tags (v5 and v6); Sonarr's own are v4.0.x.
	source: gitTags({ repo: "Sonarr/Sonarr", tag: /^v(4\.0\.\d+\.\d+)$/, paths: ["src/Sonarr.Api.V3/openapi.json"] }),
	limit: 40,
	naming: { group: "tag", prefix: /^\/api\/v3/ },
	exclude: [/^\/(?!api\/)/],
};

export default config;
