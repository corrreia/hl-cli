/**
 * Specs shipped inside Debian packages, as Proxmox ships its API schema in
 * `pve-docs`. Every download is verified the way apt verifies it: the
 * repository's `InRelease` against the release key (fetched over HTTPS),
 * `Packages` against `InRelease`, and the package against `Packages`, so the
 * repository itself can be read over plain HTTP.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SpecCandidate, SpecSource } from "./spec-config.ts";

const run = promisify(execFile);

/** One suite of a repository, such as Proxmox VE's `trixie`. */
export interface DebianSuite {
	readonly name: string;
	readonly component: string;
	/** The URL of the key that signs the suite; it must be HTTPS. */
	readonly key: string;
}

/** The options of {@link debianPackage}. */
export interface DebianPackageOptions {
	/** The repository's root, such as `http://download.proxmox.com/debian/pve`. */
	readonly repository: string;
	readonly suites: readonly DebianSuite[];
	readonly package: string;
	/**
	 * Returns the spec version a package version is for, such as `9.2` for
	 * `9.2.13`, or undefined to leave it out. Of the packages for one spec
	 * version, the newest is used.
	 */
	readonly version: (packageVersion: string) => string | undefined;
	/** The file in the package that holds the spec. */
	readonly file: string;
	/** Returns the spec from that file's text. */
	readonly convert: (text: string, version: string) => unknown;
}

interface PackageEntry {
	readonly version: string;
	readonly filename: string;
	readonly sha256: string;
}

/** A spec inside a Debian package, at each version a repository has. */
export function debianPackage(options: DebianPackageOptions): SpecSource {
	return {
		async candidates() {
			const newest = new Map<string, PackageEntry>();
			for (const suite of options.suites) {
				for (const entry of await packages(options, suite)) {
					const version = options.version(entry.version);
					const kept = version === undefined ? undefined : newest.get(version);
					if (version !== undefined && (kept === undefined || debianCompare(entry.version, kept.version) > 0)) {
						newest.set(version, entry);
					}
				}
			}
			return [...newest].map(([version, entry]): SpecCandidate => ({
				version,
				urls: [`${options.repository}/${entry.filename}`],
				load: async () => {
					const deb = await download(`${options.repository}/${entry.filename}`);
					if (sha256(deb) !== entry.sha256) {
						throw new Error(`${entry.filename}: its SHA-256 doesn't match the signed Packages index`);
					}
					return options.convert(await extract(deb, options.file), version);
				},
			}));
		},
	};
}

/** Returns the entries for the package in `suite`, verified against its signed `InRelease`. */
async function packages(options: DebianPackageOptions, suite: DebianSuite): Promise<PackageEntry[]> {
	if (!suite.key.startsWith("https://")) {
		throw new Error(`${suite.name}: the release key must come over HTTPS`);
	}
	const dist = `${options.repository}/dists/${suite.name}`;
	const signed = await verifiedRelease(await download(`${dist}/InRelease`), await download(suite.key));
	const indexPath = `${suite.component}/binary-amd64/Packages`;
	const expected = new RegExp(`^ ([0-9a-f]{64})\\s+\\d+\\s+${indexPath.replace(/[/.]/g, "\\$&")}$`, "m").exec(
		signed.slice(signed.indexOf("SHA256:")),
	)?.[1];
	if (expected === undefined) {
		throw new Error(`${suite.name}: InRelease lists no ${indexPath}`);
	}
	const index = await download(`${dist}/${indexPath}`);
	if (sha256(index) !== expected) {
		throw new Error(`${suite.name}: ${indexPath} doesn't match its signed hash`);
	}
	return index
		.toString("utf8")
		.split(/\n\n+/)
		.map((stanza) => {
			const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(stanza)?.[1]?.trim();
			return {
				name: field("Package"),
				version: field("Version"),
				filename: field("Filename"),
				sha256: field("SHA256"),
			};
		})
		.filter((entry) => entry.name === options.package)
		.flatMap((entry) =>
			entry.version !== undefined && entry.filename !== undefined && entry.sha256 !== undefined
				? [{ version: entry.version, filename: entry.filename, sha256: entry.sha256 }]
				: [],
		);
}

/** Returns the signed text of `inRelease`, after checking its signature with `key`. */
async function verifiedRelease(inRelease: Buffer, key: Buffer): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "hl-debian-"));
	try {
		await writeFile(join(dir, "key.gpg"), key);
		await writeFile(join(dir, "InRelease"), inRelease);
		const { stdout } = await run("gpgv", ["--keyring", join(dir, "key.gpg"), "--output", "-", join(dir, "InRelease")], {
			maxBuffer: 16 * 1024 * 1024,
		});
		return stdout;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Returns the text of `file` in the Debian package `deb`. */
async function extract(deb: Buffer, file: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "hl-debian-"));
	try {
		const path = join(dir, "package.deb");
		await writeFile(path, deb);
		const { stdout: members } = await run("ar", ["t", path]);
		const data = members.split("\n").find((member) => member.startsWith("data.tar"));
		if (data === undefined) {
			throw new Error("the package has no data.tar");
		}
		await run("ar", ["x", path, data], { cwd: dir });
		const { stdout } = await run("tar", ["-xOf", join(dir, data), `./${file}`], { maxBuffer: 256 * 1024 * 1024 });
		return stdout;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function download(url: string): Promise<Buffer> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${url}: ${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

function sha256(data: Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

/** Compares Debian versions well enough for one package's releases, such as `7.4-2` and `7.4-10`. */
function debianCompare(a: string, b: string): number {
	const parts = (version: string) => version.split(/[.\-+~]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
	const left = parts(a);
	const right = parts(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const x = left[i] ?? 0;
		const y = right[i] ?? 0;
		if (x !== y) {
			return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
		}
	}
	return 0;
}
