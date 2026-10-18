/**
 * Where Kavita's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "Kareadita/Kavita", tag: /^v(\d+\.\d+\.\d+\.\d+)$/, paths: ["openapi.json"] }),
	limit: 30,
	naming: { group: "tag", prefix: /^\/api/ },
};

export default config;
