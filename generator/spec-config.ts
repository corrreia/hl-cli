/**
 * How a service's specs are found and named, for `fetch-specs.ts` and
 * `generate.ts`. Each service exports one as the default of
 * `src/services/<id>/spec.ts`; it is never part of the CLI's bundle.
 */
import type { NamingOptions } from "./naming.ts";
import type { Overlay } from "./overlay.ts";

/** A published version of a spec, and the URLs it may be at, tried in order. */
export interface SpecCandidate {
	readonly version: string;
	readonly urls: readonly string[];
	/**
	 * Downloads and returns the spec, for sources that need more than a
	 * download, such as unpacking or converting it; undefined to download it
	 * from `urls`.
	 */
	readonly load?: () => Promise<unknown>;
}

/** Where a service publishes its specs. */
export interface SpecSource {
	/** Returns every published version, in any order. */
	candidates(): Promise<SpecCandidate[]>;
}

/** The build configuration of a service. */
export interface SpecConfig {
	readonly source: SpecSource;
	/**
	 * How many of the newest published versions to consider; older ones are
	 * left out. Of those, only versions whose API differs from the one before
	 * are kept.
	 */
	readonly limit?: number;
	/** How to name operations automatically; undefined to name all of them in `overrides`. */
	readonly naming?: NamingOptions;
	/** Names that replace derived ones, by `operationId` (or `METHOD /route` without one). */
	readonly overrides?: Overlay;
	/** Operations to leave out, by the same keys as `overrides`, or routes matching a pattern. */
	readonly exclude?: readonly (string | RegExp)[];
}
