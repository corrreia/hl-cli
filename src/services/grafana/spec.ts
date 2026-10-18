/**
 * Where Grafana's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "grafana/grafana", tag: /^v(\d+\.\d+\.\d+)$/, paths: ["public/openapi3.json"] }),
	limit: 80,
	naming: { group: "tag" },
};

export default config;
