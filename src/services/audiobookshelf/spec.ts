/**
 * Where Audiobookshelf's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "advplyr/audiobookshelf", tag: /^v(\d+\.\d+\.\d+)$/, paths: ["docs/openapi.json"] }),
	limit: 40,
	naming: { group: "tag", prefix: /^\/api/ },
};

export default config;
