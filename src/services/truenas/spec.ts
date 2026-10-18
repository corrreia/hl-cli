/**
 * Where TrueNAS's API comes from, and how its methods are named.
 *
 * TrueNAS publishes no OpenAPI document, and its API is JSON-RPC over
 * WebSocket; its middleware dumps every method's schema, which is converted
 * (see `generator/truenas-dump.ts`). Of the API versions a release serves,
 * the `.0` of each line is kept: every later release of that line serves it.
 */
import { words } from "../../../generator/naming.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";
import { truenasDump } from "../../../generator/truenas-dump.ts";

const config: SpecConfig = {
	source: truenasDump({
		repository: "https://github.com/truenas/middleware.git",
		branch: "master",
		image: "ghcr.io/truenas/middleware:master",
		keep: (version) => /^\d+\.\d+\.0$/.test(version),
	}),
	// `pool.dataset.query` is `pool dataset query`.
	naming: {
		group: "path",
		custom: (operation) => {
			const parts = operation.route
				.slice(1)
				.split(".")
				.map((part) => words(part).join("-"));
			return { group: parts.slice(0, -1).join(".") || "core", name: parts.at(-1) ?? "call" };
		},
		// `system.reboot`, beside `system.reboot.info`, is `system reboot run`.
		movedName: "run",
	},
};

export default config;
