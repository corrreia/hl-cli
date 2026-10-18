/**
 * Where Immich's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({
		repo: "immich-app/immich",
		tag: /^v(\d+\.\d+\.\d+)$/,
		paths: ["open-api/immich-openapi-specs.json"],
	}),
	limit: 40,
	naming: { group: "tag" },
};

export default config;
