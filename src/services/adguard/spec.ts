/**
 * Where AdGuard Home's specs come from, and how their operations are named.
 */
import { gitTags } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: gitTags({ repo: "AdguardTeam/AdGuardHome", tag: /^v(\d+\.\d+\.\d+)$/, paths: ["openapi/openapi.yaml"] }),
	limit: 40,
	naming: { group: "tag" },
};

export default config;
