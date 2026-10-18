/**
 * Where Karakeep's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({
		repo: "karakeep-app/karakeep",
		tag: /^v(\d+\.\d+\.\d+)$/,
		paths: ["packages/open-api/karakeep-openapi-spec.json"],
	}),
	limit: 40,
	naming: { group: "tag" },
};

export default config;
