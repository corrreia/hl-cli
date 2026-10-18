/**
 * Where Frigate's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({
		repo: "blakeblackshear/frigate",
		tag: /^v(\d+\.\d+\.\d+)$/,
		paths: ["docs/static/frigate-api.yaml"],
	}),
	limit: 40,
	naming: { group: "tag", ignoreOperationIds: true },
};

export default config;
