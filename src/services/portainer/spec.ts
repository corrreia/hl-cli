/**
 * Where Portainer CE's specs come from, and how their operations are named.
 * api-docs.portainer.io lists every version; newer ones are split across
 * files and older ones are Swagger 2, which `generator/load-spec.ts` handles.
 */
import { z } from "zod";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const INDEX = "https://api-docs.portainer.io/ce-versions.json";
const VersionsSchema = z.array(z.looseObject({ id: z.string(), file: z.string() }));

const config: SpecConfig = {
	source: {
		async candidates() {
			const response = await fetch(INDEX);
			if (!response.ok) {
				throw new Error(`${INDEX}: ${response.status}`);
			}
			const versions = VersionsSchema.parse(await response.json());
			return versions.map((version) => ({
				version: version.id,
				urls: [`https://api-docs.portainer.io/${version.file}`],
			}));
		},
	},
	naming: { group: "tag" },
};

export default config;
