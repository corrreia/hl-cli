/**
 * Derives a command name for every operation of a spec, for services with
 * too many operations to name by hand.
 *
 * The group comes from the operation's first tag (or its first path
 * segment), and the name from its `operationId` without the group's words,
 * or, with no `operationId`, from its HTTP method and path:
 * `GET /series` is `series list`, `GET /series/{id}` is `series get`, and
 * `POST /series/import` is `series import`. Names that clash in a group get
 * the HTTP method's verb, then a number. The same spec always gets the same
 * names, so names stay stable across versions as long as operations do.
 */
import type { Overlay, OverlayEntry } from "./overlay.ts";

/** How to derive names for a service. */
export interface NamingOptions {
	/** Where groups come from: the first tag, or the first path segment. */
	readonly group: "tag" | "path";
	/** The start of every route to ignore, such as `/api/v3`. */
	readonly prefix?: RegExp;
	/** Renames a derived group (after kebab-casing), such as `system-info` to `system`. */
	readonly groupAliases?: Readonly<Record<string, string>>;
	/** Names from the method and path even when operations have ids, for ids that are noise. */
	readonly ignoreOperationIds?: boolean;
	/**
	 * Names an operation itself, given every operation of the spec: its group,
	 * with `.` between nested groups, and its name; undefined to name it the
	 * usual way. Clashes are still resolved as for derived names.
	 */
	readonly custom?: (
		operation: NamedOperation,
		all: readonly NamedOperation[],
	) => { group: string; name: string } | undefined;
}

/** An operation, as the spec has it. */
export interface NamedOperation {
	readonly route: string;
	/** Lower-case, such as `get`. */
	readonly method: string;
	readonly operationId: string | undefined;
	readonly tags: readonly string[];
}

const VERBS: Readonly<Record<string, string>> = {
	get: "get",
	post: "create",
	put: "update",
	patch: "patch",
	delete: "delete",
	head: "head",
	options: "options",
	trace: "trace",
};

/** Returns the words of `text`: `getAllAlbums` and `get_all-albums` are `get all albums`. */
export function words(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word !== "");
}

/** Returns the key an operation's names are kept under: its method and route. */
export function operationKey(operation: Pick<NamedOperation, "method" | "route">): string {
	return `${operation.method.toUpperCase()} ${operation.route}`;
}

/**
 * Returns the command of every operation, by `operationId` when it has one
 * and by {@link operationKey} when it doesn't.
 */
export function deriveOverlay(operations: readonly NamedOperation[], options: NamingOptions): Overlay {
	const named = operations.map((operation) => {
		const custom = options.custom?.(operation, operations);
		if (custom !== undefined) {
			return { operation, ...custom };
		}
		const group = groupOf(operation, options);
		return { operation, group, name: nameOf(operation, group, options) };
	});

	// A command can't share its name with a group beside it (`qemu status` and
	// `qemu status start`): it moves into that group, as its `index` (or verb).
	const groups = new Set(
		named.flatMap((entry) => entry.group.split(".").map((_, i, parts) => parts.slice(0, i + 1).join("."))),
	);
	for (const entry of named) {
		const asGroup = entry.group === "" ? entry.name : `${entry.group}.${entry.name}`;
		if (groups.has(asGroup)) {
			entry.group = asGroup;
			entry.name =
				entry.operation.method === "get" ? "index" : (VERBS[entry.operation.method] ?? entry.operation.method);
		}
	}

	// Names that clash in a group are made longer, a step at a time, until they don't:
	// the whole operationId, the trailing path parameter, the verb, and last a number.
	for (const pass of ["full", "param", "verb", "number"] as const) {
		const byName = new Map<string, typeof named>();
		for (const entry of named) {
			const key = `${entry.group}\u0000${entry.name}`;
			byName.set(key, [...(byName.get(key) ?? []), entry]);
		}
		for (const clash of byName.values()) {
			if (clash.length < 2) {
				continue;
			}
			const sorted = [...clash].sort((a, b) => operationKey(a.operation).localeCompare(operationKey(b.operation)));
			// The one GET of a clash keeps the plain name, so reading stays short: `config`, `config-update`.
			const gets = sorted.filter((entry) => entry.operation.method === "get");
			for (const [i, entry] of sorted.entries()) {
				if (pass === "verb" && gets.length === 1 && gets[0] === entry) {
					continue;
				}
				entry.name = lengthen(entry.name, entry.operation, pass, i, options);
			}
		}
	}

	const overlay: Record<string, OverlayEntry> = {};
	for (const { operation, group, name } of named) {
		overlay[operation.operationId ?? operationKey(operation)] = { group, method: name };
	}
	return overlay;
}

/** Returns `name` made longer by one step of {@link deriveOverlay}'s clash passes. */
function lengthen(
	name: string,
	operation: NamedOperation,
	pass: "full" | "param" | "verb" | "number",
	index: number,
	options: NamingOptions,
): string {
	switch (pass) {
		case "full": {
			const id = operationIdOf(operation, options);
			return id === undefined ? name : words(id).join("-");
		}
		case "param": {
			const param = /\{([^}]+)\}\/?$/.exec(operation.route)?.[1];
			return param === undefined || operationIdOf(operation, options) !== undefined
				? name
				: `${name}-by-${words(param).join("-")}`;
		}
		case "verb": {
			const verb = VERBS[operation.method] ?? operation.method;
			return name.endsWith(verb) ? name : `${name}-${verb}`;
		}
		case "number":
			return index === 0 ? name : `${name}-${index + 1}`;
		default:
			return casesHandled(pass);
	}
}

/** Returns the operationId names come from, if names come from ids, without a numbered suffix such as `_1`. */
function operationIdOf(operation: NamedOperation, options: NamingOptions): string | undefined {
	return options.ignoreOperationIds === true ? undefined : operation.operationId?.replace(/_\d+$/, "");
}

function casesHandled(unexpected: never): never {
	throw new Error(`unexpected case: ${String(unexpected)}`);
}

function groupOf(operation: NamedOperation, options: NamingOptions): string {
	const [tag] = operation.tags;
	const source = options.group === "tag" && tag !== undefined ? tag : (staticSegments(operation, options)[0] ?? "root");
	// Spring names tags after controllers, as `book-controller`.
	const kebab =
		words(source)
			.filter((word) => word !== "controller")
			.join("-") || "root";
	return options.groupAliases?.[kebab] ?? kebab;
}

function nameOf(operation: NamedOperation, group: string, options: NamingOptions): string {
	const groupWords = new Set(group.split("-").flatMap((word) => [word, singular(word)]));
	const withoutGroup = (all: readonly string[]) => {
		const kept = all.filter((word) => !groupWords.has(word) && !groupWords.has(singular(word)));
		return kept.length > 0 ? kept : all;
	};
	const id = operationIdOf(operation, options);
	if (id !== undefined) {
		return withoutGroup(words(id)).join("-");
	}
	// No operationId: the path after the segment that names the group, and the method.
	const segments = staticSegments(operation, options);
	const at = segments.findIndex((segment) => abbreviates(compact(segment), compact(group)));
	const tail = segments.slice(at + 1).flatMap((segment) => words(segment));
	if (tail.length > 0) {
		return withoutGroup(tail).join("-");
	}
	const endsWithParam = operation.route.replace(/\/+$/, "").endsWith("}");
	switch (operation.method) {
		case "get":
			return endsWithParam ? "get" : "list";
		case "post":
			return "create";
		default:
			return VERBS[operation.method] ?? operation.method;
	}
}

/** Returns the route's segments that aren't parameters, after the prefix. */
function staticSegments(operation: NamedOperation, options: NamingOptions): string[] {
	const route = options.prefix === undefined ? operation.route : operation.route.replace(options.prefix, "");
	return route.split("/").filter((segment) => segment !== "" && !segment.includes("{"));
}

function singular(word: string): string {
	if (word.endsWith("ies") && word.length > 4) {
		return `${word.slice(0, -3)}y`;
	}
	if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
		return word.slice(0, -1);
	}
	return word;
}

/**
 * Whether `short` names `long`: the same, or its letters in order, as
 * `alttitle` is of `alternativetitle` and `customformat` of `custom-format`.
 */
function abbreviates(short: string, long: string): boolean {
	if (short === long || singular(short) === singular(long)) {
		return true;
	}
	let i = 0;
	for (const letter of long) {
		if (letter === short[i]) {
			i++;
		}
	}
	return short.length >= 3 && short[0] === long[0] && i === short.length;
}

function compact(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}
