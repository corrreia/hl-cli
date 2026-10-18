/**
 * Picks which bundled catalogue to use for the version a server runs.
 */

/** How the catalogue picked relates to the server's version. */
export type VersionMatch =
	/** A catalogue of exactly the server's version. */
	| { readonly kind: "exact"; readonly version: string }
	/** The newest catalogue older than the server's version. */
	| { readonly kind: "older"; readonly version: string }
	/** The server is older than every catalogue: the oldest is used. */
	| { readonly kind: "server-older"; readonly version: string };

/**
 * Compares two dotted versions, such as `10.6.106` and `9.4.19`, number by
 * number; a part that isn't a number compares as text. Returns a negative
 * number, zero, or a positive number, as `a` is older, the same, or newer.
 */
export function compareVersions(a: string, b: string): number {
	const left = parts(a);
	const right = parts(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const x = left[i] ?? 0;
		const y = right[i] ?? 0;
		if (x === y) {
			continue;
		}
		if (typeof x === "number" && typeof y === "number") {
			return x - y;
		}
		return String(x).localeCompare(String(y));
	}
	return 0;
}

/**
 * Returns the catalogue to use for a server running `server`: the newest of
 * `available` that isn't newer, or the oldest if all are. `available` must
 * not be empty.
 */
export function pickVersion(available: readonly string[], server: string): VersionMatch {
	const sorted = [...available].sort(compareVersions);
	const [oldest] = sorted;
	if (oldest === undefined) {
		throw new Error("pickVersion needs at least one version");
	}
	let match: VersionMatch = { kind: "server-older", version: oldest };
	for (const version of sorted) {
		const order = compareVersions(version, server);
		if (order > 0) {
			break;
		}
		match = { kind: order === 0 ? "exact" : "older", version };
	}
	return match;
}

/** Returns the newest of `available`, which must not be empty. */
export function newestVersion(available: readonly string[]): string {
	const newest = [...available].sort(compareVersions).at(-1);
	if (newest === undefined) {
		throw new Error("newestVersion needs at least one version");
	}
	return newest;
}

function parts(version: string): (number | string)[] {
	return version
		.replace(/^v/i, "")
		.split(/[.\-+]/)
		.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}
