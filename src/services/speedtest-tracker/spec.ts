/**
 * Where Speedtest Tracker's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "alexjustesen/speedtest-tracker", tag: /^v(\d+\.\d+\.\d+)$/, paths: ["openapi.json"] }),
	limit: 40,
	naming: { group: "tag", prefix: /^\/api\/v1/ },
};

export default config;
