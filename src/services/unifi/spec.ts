/**
 * Where UniFi Network's specs come from, and their command names.
 */
import { listedVersions } from "../../../generator/sources.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";
import overlay from "./overlay.ts";

const config: SpecConfig = {
	// Ubiquiti's developer site lists each version's docs in its sitemap.
	source: listedVersions({
		index: "https://developer.ui.com/sitemap.xml",
		pattern: /\/network\/v(\d+\.\d+\.\d+)</g,
		url: (version) => `https://developer.ui.com/network/v${version}/openapi.json`,
	}),
	// Every operation is named by hand.
	overrides: overlay,
};

export default config;
