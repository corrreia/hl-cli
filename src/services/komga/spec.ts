/**
 * Where Komga's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "gotson/komga", tag: /^v(\d+\.\d+\.\d+)$/, paths: ["komga/docs/openapi.json"] }),
	limit: 40,
	naming: { group: "tag", prefix: /^\/api\/v\d+/ },
};

export default config;
