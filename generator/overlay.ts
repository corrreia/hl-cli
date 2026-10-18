/**
 * Prepares a service's OpenAPI document for forge: names every operation
 * through forge's extensions, leaves out excluded ones, and sets the
 * version to the release it came from.
 */
import { Result, TaggedError } from "better-result";
import { z } from "zod";
import { operationKey, type NamedOperation } from "./naming.ts";

/** The command an operation becomes: its group, dot-separated, and its name in the group. */
export interface OverlayEntry {
	readonly group: string;
	readonly method: string;
	/** The sentence to confirm before running it. DELETE operations always confirm. */
	readonly confirm?: string;
}

/** The command of every operation of a service, by `operationId` (or `METHOD /route` without one). */
export type Overlay = Readonly<Record<string, OverlayEntry>>;

/** Operations in the document that the overlay does not name. */
export class UnnamedOperations extends TaggedError("UnnamedOperations")<{
	readonly operationIds: readonly string[];
	readonly message: string;
}> {}

/** The document is not an OpenAPI document `hl` can read. */
export class InvalidSpec extends TaggedError("InvalidSpec")<{
	readonly issues: string;
	readonly message: string;
}> {}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

const OperationSchema = z.looseObject({
	operationId: z.string().optional(),
	tags: z.array(z.string()).optional(),
});
const SpecSchema = z.looseObject({
	openapi: z.string().regex(/^3\./, "hl reads OpenAPI 3 documents"),
	info: z.looseObject({}),
	paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** A parsed spec. */
export type Spec = z.infer<typeof SpecSchema>;

/** Parses an OpenAPI 3 document. */
export function parseSpec(spec: unknown): Result<Spec, InvalidSpec> {
	const parsed = SpecSchema.safeParse(spec);
	if (!parsed.success) {
		return Result.err(new InvalidSpec({ issues: z.prettifyError(parsed.error), message: "Not an OpenAPI 3 document" }));
	}
	return Result.ok(parsed.data);
}

/** Returns every operation of `spec`, for naming. */
export function listOperations(spec: Spec): NamedOperation[] {
	const out: NamedOperation[] = [];
	for (const [route, item] of Object.entries(spec.paths)) {
		for (const [method, value] of Object.entries(item)) {
			const operation = HTTP_METHODS.has(method) ? OperationSchema.safeParse(value) : undefined;
			if (operation?.success === true) {
				out.push({ route, method, operationId: operation.data.operationId, tags: operation.data.tags ?? [] });
			}
		}
	}
	return out;
}

/** The options of {@link prepareSpec}. */
export interface PrepareOptions {
	/** The release the document came from, written over its `info.version`. */
	readonly version: string;
	readonly overlay: Overlay;
	readonly exclude?: readonly (string | RegExp)[] | undefined;
}

/**
 * Returns `spec` with every operation named by the overlay, through forge's
 * `x-fern-sdk-group-name`, `x-fern-sdk-method-name` and
 * `x-forge-require-confirmation` extensions, and excluded ones removed.
 * Fails if an operation has no entry, so a new version of a spec can't add
 * unnamed commands.
 */
export function prepareSpec(spec: Spec, options: PrepareOptions): Result<Spec, UnnamedOperations> {
	const excluded = (key: string, route: string) =>
		(options.exclude ?? []).some((rule) => (typeof rule === "string" ? rule === key : rule.test(route)));
	const unnamed: string[] = [];
	const paths: Record<string, Record<string, unknown>> = {};
	for (const [route, item] of Object.entries(spec.paths)) {
		const nextItem: Record<string, unknown> = {};
		let operations = 0;
		const shared: readonly unknown[] = Array.isArray(item["parameters"]) ? item["parameters"] : [];
		for (const [method, value] of Object.entries(item)) {
			if (method === "parameters") {
				continue;
			}
			const operation = HTTP_METHODS.has(method) ? OperationSchema.safeParse(value) : undefined;
			if (operation === undefined || !operation.success) {
				nextItem[method] = value;
				continue;
			}
			const key = operation.data.operationId ?? operationKey({ method, route });
			if (excluded(key, route)) {
				continue;
			}
			const entry = options.overlay[key];
			if (entry === undefined) {
				unnamed.push(key);
				continue;
			}
			operations++;
			nextItem[method] = {
				...operation.data,
				parameters: mergeParameters(
					spec,
					shared,
					Array.isArray(operation.data["parameters"]) ? operation.data["parameters"] : [],
				),
				"x-fern-sdk-group-name": entry.group,
				"x-fern-sdk-method-name": entry.method,
				// Left out of the JSON when undefined.
				"x-forge-require-confirmation":
					entry.confirm ?? operation.data["x-forge-require-confirmation"] ?? (method === "delete" ? "" : undefined),
			};
		}
		if (operations > 0) {
			paths[route] = nextItem;
		}
	}
	if (unnamed.length > 0) {
		return Result.err(
			new UnnamedOperations({
				operationIds: unnamed,
				message: `The overlay names no command for: ${unnamed.join(", ")}`,
			}),
		);
	}
	return Result.ok({ ...spec, info: { ...spec.info, version: options.version }, paths });
}

/**
 * Returns an operation's parameters with its path's shared ones, as OpenAPI
 * merges them: the operation's own replace shared ones of the same name and
 * location. Parameters that still share a name, in different locations, are
 * left out but the path one, since a command line can't tell them apart;
 * so are query parameters in styles forge doesn't read, such as
 * `deepObject`, which a command line can't write either.
 */
function mergeParameters(spec: Spec, shared: readonly unknown[], own: readonly unknown[]): unknown[] {
	const identity = (parameter: unknown) => {
		const resolved = resolveParameter(spec, parameter);
		return { name: resolved?.name ?? "", in: resolved?.in ?? "" };
	};
	const ownKeys = new Set(own.map((parameter) => JSON.stringify(identity(parameter))));
	const merged = [...shared.filter((parameter) => !ownKeys.has(JSON.stringify(identity(parameter)))), ...own];
	const byName = new Map<string, unknown>();
	for (const parameter of merged) {
		const style = resolveParameter(spec, parameter)?.style;
		if (style !== undefined && style !== "form" && style !== "simple") {
			continue;
		}
		const { name, in: location } = identity(parameter);
		const kept = byName.get(name);
		if (kept === undefined || (location === "path" && identity(kept).in !== "path")) {
			byName.set(name, parameter);
		}
	}
	return [...byName.values()];
}

const ParameterSchema = z.looseObject({ name: z.string(), in: z.string(), style: z.string().optional() });

/** Returns the name and location of a parameter, following a `$ref` into `components.parameters`. */
function resolveParameter(spec: Spec, parameter: unknown): z.infer<typeof ParameterSchema> | undefined {
	const ref = z.looseObject({ $ref: z.string() }).safeParse(parameter);
	if (ref.success) {
		const name = ref.data.$ref.replace("#/components/parameters/", "");
		const components = z.looseObject({ parameters: z.record(z.string(), z.unknown()) }).safeParse(spec["components"]);
		return components.success ? resolveParameter(spec, components.data.parameters[name]) : undefined;
	}
	const direct = ParameterSchema.safeParse(parameter);
	return direct.success ? direct.data : undefined;
}
