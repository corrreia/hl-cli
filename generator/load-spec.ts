/**
 * Loads a published spec as one OpenAPI 3 document: JSON or YAML, with
 * `$ref`s to other files (as split specs have) bundled in, and Swagger 2
 * converted.
 */
import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import { convertObj } from "swagger2openapi";

/** A Swagger 2 document, as swagger2openapi takes it. */
type Swagger2 = Parameters<typeof convertObj>[0];
/** Returns the spec at the first of `urls` that has one, or undefined if none does. */
export async function loadSpec(urls: readonly string[]): Promise<unknown> {
	for (const url of urls) {
		const head = await fetch(url, { method: "HEAD" });
		if (!head.ok && head.status !== 405) {
			continue;
		}
		let bundled: unknown;
		try {
			bundled = await $RefParser.bundle(url, { resolve: { http: { timeout: 60_000 } } });
		} catch {
			continue;
		}
		const spec = isSwagger2(bundled) ? (await convertObj(bundled, { patch: true, warnOnly: true })).openapi : bundled;
		return inlineRefs(spec, spec, 0);
	}
	return undefined;
}

/** How deep to follow refs while inlining, so cycles end. */
const MAX_DEPTH = 32;

/**
 * Returns `value` with every `$ref` that points outside `components` (as
 * bundling leaves refs into other operations, `#/paths/…`) replaced by what
 * it points to, since forge only follows refs into `components`.
 */
function inlineRefs(value: unknown, root: unknown, depth: number): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => inlineRefs(item, root, depth));
	}
	if (typeof value !== "object" || value === null) {
		return value;
	}
	const entries = Object.entries(value);
	const ref = entries.find(([key]) => key === "$ref")?.[1];
	if (typeof ref === "string" && ref.startsWith("#/") && !ref.startsWith("#/components/") && depth < MAX_DEPTH) {
		// A ref that leads nowhere is any value.
		return inlineRefs(pointer(root, ref, 0) ?? {}, root, depth + 1);
	}
	return Object.fromEntries(entries.map(([key, item]) => [key, inlineRefs(item, root, depth)]));
}

/**
 * Returns what the JSON pointer `ref` (`#/a/b~1c`) points to in `root`,
 * following refs it passes through.
 */
function pointer(root: unknown, ref: string, depth: number): unknown {
	let current = root;
	for (const part of ref.slice(2).split("/")) {
		const through = refOf(current);
		if (through !== undefined && depth < MAX_DEPTH) {
			current = pointer(root, through, depth + 1);
		}
		const key = decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~");
		const entry =
			typeof current === "object" && current !== null ? Object.entries(current).find(([k]) => k === key) : undefined;
		current = entry?.[1];
	}
	return current;
}

function refOf(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const ref = Object.entries(value).find(([key]) => key === "$ref")?.[1];
	return typeof ref === "string" && ref.startsWith("#/") ? ref : undefined;
}

function isSwagger2(spec: unknown): spec is Swagger2 {
	return typeof spec === "object" && spec !== null && "swagger" in spec && spec.swagger === "2.0";
}

/**
 * Returns `value` without `example` and `examples`, which hl doesn't use and
 * which sometimes hold sample credentials (Grafana's show a service account
 * token) that secret scanners rightly flag. A schema property named
 * `example` is kept.
 */
export function withoutExamples(value: unknown, parentKey = ""): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => withoutExamples(item));
	}
	if (typeof value !== "object" || value === null) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => parentKey === "properties" || (key !== "example" && key !== "examples"))
			.map(([key, item]) => [key, withoutExamples(item, key)]),
	);
}
