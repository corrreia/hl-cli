/**
 * Where authentik's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "goauthentik/authentik", tag: /^version\/(\d+\.\d+\.\d+)$/, paths: ["schema.yml"] }),
	limit: 10,
	naming: { group: "tag" },
};

export default config;
