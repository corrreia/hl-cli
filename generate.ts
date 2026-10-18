/**
 * Generates the command catalogues: for every spec in `specs/<service>/`,
 * names its operations as `src/services/<service>/spec.ts` says, and runs
 * forge with the `generator/hl.wasm` plugin. The catalogues of a service's
 * versions share most commands, so they're written as one module,
 * `src/services/<service>/_generated/catalogs.ts`, that keeps each distinct
 * command once, with `versions.ts` to load it for any version.
 *
 * Run it with `pnpm generate`, which compiles the plugin first. With
 * service names as arguments, it generates only those.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deriveOverlay } from "./generator/naming.ts";
import { listOperations, parseSpec, prepareSpec } from "./generator/overlay.ts";
import type { SpecConfig } from "./generator/spec-config.ts";
import type { Catalog } from "./src/catalog.ts";

const run = promisify(execFile);
const root = import.meta.dirname;
const forge = join(root, "node_modules", ".bin", "forge");
const plugin = join(root, "generator", "hl.wasm");
const wanted = process.argv.slice(2);

let failed = false;
for (const service of readdirSync(join(root, "specs")).sort()) {
	if (wanted.length > 0 && !wanted.includes(service)) {
		continue;
	}
	const configModule: { default: SpecConfig } = await import(`./src/services/${service}/spec.ts`);
	const config = configModule.default;
	const outDir = join(root, "src", "services", service, "_generated");
	const cacheDir = join(root, ".cache", "specs", service);
	const catalogDir = join(root, ".cache", "catalogs", service);
	rmSync(outDir, { recursive: true, force: true });
	rmSync(catalogDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	mkdirSync(cacheDir, { recursive: true });
	mkdirSync(catalogDir, { recursive: true });

	const files = readdirSync(join(root, "specs", service)).filter((name) => name.endsWith(".json"));
	const jobs = files.map((file) => async () => {
		const version = file.slice(0, -".json".length);
		const raw: unknown = JSON.parse(readFileSync(join(root, "specs", service, file), "utf8"));
		const spec = parseSpec(raw);
		if (spec.isErr()) {
			throw new Error(`${service} ${version}: ${spec.error.message}\n${spec.error.issues}`);
		}
		const derived = config.naming === undefined ? {} : deriveOverlay(listOperations(spec.value), config.naming);
		const overlay = { ...derived, ...config.overrides };
		const prepared = prepareSpec(spec.value, { version, overlay, exclude: config.exclude });
		if (prepared.isErr()) {
			throw new Error(`${service} ${version}: ${prepared.error.message}`);
		}
		const preparedPath = join(cacheDir, file);
		writeFileSync(preparedPath, JSON.stringify(prepared.value));
		try {
			await run(forge, [preparedPath, "--target", `wasm://${plugin}`, "--out", join(catalogDir, version)], {
				maxBuffer: 64 * 1024 * 1024,
			});
		} catch (cause: unknown) {
			const stderr =
				typeof cause === "object" && cause !== null && "stderr" in cause ? String(cause.stderr) : String(cause);
			throw new Error(`${service} ${version}: forge failed\n${stderr.trim()}`);
		}
		return version;
	});

	const versions: string[] = [];
	for (const result of await inParallel(jobs, cpus().length)) {
		if (result.status === "fulfilled") {
			versions.push(result.value);
		} else {
			failed = true;
			console.error(`[hl-generate] ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
		}
	}
	const catalogs: Catalog[] = [];
	for (const version of versions.sort()) {
		const module: { default: Catalog } = await import(join(catalogDir, version, `${version}.ts`));
		catalogs.push(module.default);
	}
	const pooled = renderCatalogs(catalogs);
	writeFileSync(join(outDir, "catalogs.ts"), pooled.source);
	writeFileSync(join(outDir, "versions.ts"), renderVersions(versions));
	console.log(`[hl-generate] ${service}: ${versions.length} version(s), ${pooled.commands} distinct commands`);
}
if (failed) {
	process.exit(1);
}

/** Runs `jobs`, at most `limit` at a time, and returns how each went, in order. */
async function inParallel<T>(jobs: readonly (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
	const results: PromiseSettledResult<T>[] = [];
	let next = 0;
	const worker = async () => {
		for (let i = next++; i < jobs.length; i = next++) {
			const job = jobs[i];
			if (job !== undefined) {
				results[i] = await job().then(
					(value): PromiseFulfilledResult<T> => ({ status: "fulfilled", value }),
					(reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
				);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
	return results;
}

/**
 * Returns the module that keeps every catalogue of a service: each distinct
 * command and group once, and each version as the indexes of its own.
 */
function renderCatalogs(catalogs: readonly Catalog[]): { source: string; commands: number } {
	const commands = new Map<string, number>();
	const groups = new Map<string, number>();
	const index = (pool: Map<string, number>, value: unknown) => {
		const key = JSON.stringify(value);
		let at = pool.get(key);
		if (at === undefined) {
			at = pool.size;
			pool.set(key, at);
		}
		return at;
	};
	const versions = Object.fromEntries(
		catalogs.map((catalog) => [
			catalog.version,
			[
				catalog.commands.map((command) => index(commands, command)),
				catalog.groups.map((group) => index(groups, group)),
			],
		]),
	);
	const source = [
		"// Generated by generate.ts from the catalogues generator/plugin.ts writes. Do not edit.",
		'import type { Catalog, CommandSpec, GroupSpec } from "../../../catalog.ts";',
		"",
		`const commands: readonly CommandSpec[] = [${[...commands.keys()].join(",")}];`,
		"",
		`const groups: readonly GroupSpec[] = [${[...groups.keys()].join(",")}];`,
		"",
		`const versions: Readonly<Record<string, readonly [readonly number[], readonly number[]]>> = ${JSON.stringify(versions)};`,
		"",
		"/** Returns the catalogue of `version`, which must be one of the versions above. */",
		"export function catalog(version: string): Catalog {",
		"\tconst indexes = versions[version];",
		"\tif (indexes === undefined) {",
		"\t\tthrow new Error(`no catalogue for ${version}`);",
		"\t}",
		"\tconst pick = <T>(pool: readonly T[], at: readonly number[]) => at.flatMap((i) => pool[i] ?? []);",
		"\treturn { version, commands: pick(commands, indexes[0]), groups: pick(groups, indexes[1]) };",
		"}",
		"",
	].join("\n");
	return { source, commands: commands.size };
}

/** Returns the module that maps each version to its catalogue. */
function renderVersions(versions: readonly string[]): string {
	const entries = versions.map(
		(version) =>
			`\t${JSON.stringify(version)}: () => import("./catalogs.ts").then((m) => ({ default: m.catalog(${JSON.stringify(version)}) })),`,
	);
	return [
		"// Generated by generate.ts. Do not edit.",
		'import type { CatalogLoaders } from "../../../catalog.ts";',
		"",
		"const versions: CatalogLoaders = {",
		...entries,
		"};",
		"",
		"export default versions;",
		"",
	].join("\n");
}
