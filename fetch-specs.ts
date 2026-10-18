/**
 * Downloads the published versions of each service's spec into
 * `specs/<service>/<version>.json`, as `src/services/<service>/spec.ts`
 * says where they are. Of the newest `limit` versions, it keeps only those
 * whose API differs from the version before it, so a server between two
 * kept versions uses the older one's commands, which are its own. Specs are
 * saved as one OpenAPI 3 JSON document each (see `generator/load-spec.ts`),
 * without examples.
 * Run `pnpm generate` afterwards.
 *
 * `node fetch-specs.ts` — every service; `node fetch-specs.ts jellyfin` — one.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSpec, withoutExamples } from "./generator/load-spec.ts";
import type { SpecConfig } from "./generator/spec-config.ts";
import { compareVersions } from "./src/version.ts";

const root = import.meta.dirname;
const wanted = process.argv.slice(2);
const DEFAULT_LIMIT = 40;

for (const service of readdirSync(join(root, "src", "services")).sort()) {
	if (
		(wanted.length > 0 && !wanted.includes(service)) ||
		!existsSync(join(root, "src", "services", service, "spec.ts"))
	) {
		continue;
	}
	const configModule: { default: SpecConfig } = await import(`./src/services/${service}/spec.ts`);
	const config = configModule.default;
	const dir = join(root, "specs", service);
	mkdirSync(dir, { recursive: true });

	// Versions already looked at and left out, because their API was the same as the one before.
	const skippedPath = join(dir, "skipped.txt");
	const skipped = new Set(
		existsSync(skippedPath)
			? readFileSync(skippedPath, "utf8")
					.split("\n")
					.filter((v) => v !== "")
			: [],
	);

	const candidates = (await config.source.candidates()).sort((a, b) => compareVersions(a.version, b.version));
	const recent = candidates.slice(-(config.limit ?? DEFAULT_LIMIT));
	const added: string[] = [];
	let previous: string | undefined;
	for (const candidate of recent) {
		const path = join(dir, `${candidate.version}.json`);
		if (existsSync(path)) {
			previous = signature(JSON.parse(readFileSync(path, "utf8")));
			continue;
		}
		if (skipped.has(candidate.version)) {
			continue;
		}
		const spec = candidate.load === undefined ? await loadSpec(candidate.urls) : await candidate.load();
		if (spec === undefined) {
			console.error(`[hl-fetch] ${service} ${candidate.version}: no spec at ${candidate.urls.join(" or ")}`);
			continue;
		}
		const current = signature(spec);
		if (current === previous) {
			skipped.add(candidate.version);
			continue;
		}
		writeFileSync(path, JSON.stringify(withoutExamples(spec)));
		added.push(candidate.version);
		previous = current;
	}
	writeFileSync(skippedPath, `${[...skipped].sort(compareVersions).join("\n")}\n`);
	console.log(`[hl-fetch] ${service}: ${added.length === 0 ? "up to date" : `added ${added.join(", ")}`}`);
}

/**
 * Returns a hash of what a spec's commands are made of: its operations and
 * schemas, without the prose, so a release that only reworded docs isn't
 * kept as a version of its own.
 */
function signature(spec: unknown): string {
	const record = typeof spec === "object" && spec !== null ? spec : {};
	const shape = {
		paths: "paths" in record ? record.paths : undefined,
		components: "components" in record ? record.components : undefined,
	};
	const text = JSON.stringify(shape, (key, value: unknown) =>
		key === "description" || key === "summary" || key === "example" || key === "examples" ? undefined : value,
	);
	return createHash("sha256").update(text).digest("hex");
}
