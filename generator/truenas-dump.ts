/**
 * TrueNAS's API, from its own dump: `middlewared --dump-api`, run in the
 * container image TrueNAS builds its middleware in, on a shallow clone of
 * its source. One dump has every API version that release serves.
 *
 * Needs Docker. The container runs without a network, with the source
 * mounted read-only.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseDump, truenasToOpenApi } from "./convert/truenas.ts";
import type { SpecCandidate, SpecSource } from "./spec-config.ts";

const run = promisify(execFile);

/** The options of {@link truenasDump}. */
export interface TruenasDumpOptions {
	/** The middleware's git repository. */
	readonly repository: string;
	/** The branch to dump. */
	readonly branch: string;
	/** The image with the middleware's dependencies. */
	readonly image: string;
	/** Whether to keep an API version, such as `25.10.0`. */
	readonly keep: (version: string) => boolean;
}

/** TrueNAS's API versions, from a dump of its middleware. */
export function truenasDump(options: TruenasDumpOptions): SpecSource {
	return {
		async candidates() {
			const source = join(import.meta.dirname, "..", ".cache", "truenas", "middleware");
			if (existsSync(join(source, ".git"))) {
				await run("git", ["-C", source, "fetch", "--quiet", "--depth", "1", "origin", options.branch]);
				await run("git", ["-C", source, "reset", "--quiet", "--hard", "FETCH_HEAD"]);
			} else {
				mkdirSync(join(source, ".."), { recursive: true });
				await run("git", ["clone", "--quiet", "--depth", "1", "--branch", options.branch, options.repository, source]);
			}
			const { stdout } = await run(
				"docker",
				[
					"run",
					"--rm",
					"--network",
					"none",
					"--volume",
					`${source}:/middleware:ro`,
					"--workdir",
					"/middleware/src/middlewared",
					"--env",
					"FAKE_ENV=1",
					"--env",
					"PYTHONPATH=/middleware/src/middlewared",
					options.image,
					"python3",
					"-m",
					"middlewared.main",
					"--dump-api",
				],
				{ maxBuffer: 1024 * 1024 * 1024 },
			);
			const versions = parseDump(JSON.parse(stdout));
			return [...versions]
				.filter(([version]) => options.keep(version))
				.map(([version, api]): SpecCandidate => ({
					version,
					urls: [],
					load: () => Promise.resolve(truenasToOpenApi(api, version)),
				}));
		},
	};
}
