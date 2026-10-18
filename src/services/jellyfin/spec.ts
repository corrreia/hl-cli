/**
 * Where Jellyfin's specs come from, and how their operations are named.
 */
import { listedVersions } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const config: SpecConfig = {
	source: listedVersions({
		index: "https://repo.jellyfin.org/files/openapi/stable/",
		pattern: /jellyfin-openapi-(\d+(?:\.\d+)+)\.json/g,
		url: (version) => `https://repo.jellyfin.org/files/openapi/stable/jellyfin-openapi-${version}.json`,
	}),
	limit: 30,
	naming: { group: "tag" },
};

export default config;
