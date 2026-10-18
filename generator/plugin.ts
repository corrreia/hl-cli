/**
 * The forge plugin that turns one version of a service's OpenAPI document
 * into a command catalogue: `<version>.ts`, a module whose default export
 * is a `Catalog` (see `src/catalog.ts`).
 *
 * `forge-plugin build` compiles it to `generator/hl.wasm`; `generate.ts` runs
 * forge with it for every bundled spec.
 */
import { definePlugin, type Field, type Json, type Method, type Type } from "@cloudflare/forge/plugin";
import type { BodySpec, Catalog, CommandSpec, GroupSpec, ParamSpec, RpcSpec, ValueType } from "../src/catalog.ts";

/** How deep to follow models when reading a type, so recursive schemas end. */
const MAX_DEPTH = 8;

/** The longest description kept for a command, and for a flag; help shows no more. */
const COMMAND_TEXT = 600;
const FLAG_TEXT = 240;

const plugin = definePlugin({
	generate(forge) {
		const groups: GroupSpec[] = [];
		const commands: CommandSpec[] = [];
		for (const group of forge.groups) {
			const path = group.path.map((name) => name.kebab());
			groups.push({ path, description: brief(group.description, FLAG_TEXT) });
			for (const method of group.methods) {
				commands.push(command(path, method));
			}
		}
		const catalog: Catalog = { version: forge.version, groups, commands };
		return [{ path: `${forge.version}.ts`, content: render(catalog) }];
	},
});

// forge calls the entry module's exports by these names.
export const generate = () => plugin.generate();
export const generateGroup = (group: number) => plugin.generateGroup(group);

/** Returns the command for `method`, in the group at `groupPath`. */
function command(groupPath: readonly string[], method: Method): CommandSpec {
	return {
		path: [...groupPath, method.name.kebab()],
		summary: brief(method.summary, FLAG_TEXT),
		description: brief(method.description, COMMAND_TEXT),
		method: method.httpMethod,
		route: method.path,
		params: params(method),
		body: body(method),
		confirmation: method.confirmation,
		hidden: method.hidden,
		deprecated: method.deprecated,
		rpc: rpc(method),
	};
}

/** Returns how to call `method` over JSON-RPC, from its `x-hl-rpc` extension, or undefined if it has none. */
function rpc(method: Method): RpcSpec | undefined {
	const value = method.extension("x-hl-rpc");
	if (!isJsonObject(value)) {
		return undefined;
	}
	const { method: name, params, job, defaults } = value;
	if (typeof name !== "string" || !Array.isArray(params) || !params.every((param) => typeof param === "string")) {
		throw new Error(`${method.httpMethod} ${method.path}: x-hl-rpc needs a method and its params`);
	}
	return { method: name, params, job: job === true, defaults: isJsonObject(defaults) ? defaults : undefined };
}

/** Returns the path and query parameters of `method`, path parameters first, in route order. */
function params(method: Method): ParamSpec[] {
	const out: ParamSpec[] = [];
	for (const field of objectFields(method.request, 0)) {
		const location = method.location(field);
		if (location === undefined) {
			continue;
		}
		out.push({
			wireName: field.wireName,
			flag: field.name.kebab(),
			in: location.in,
			required: field.required || location.in === "path",
			description: brief(field.description, FLAG_TEXT),
			type: valueType(field.type, 0),
		});
	}
	const routeIndex = (param: ParamSpec) => method.path.indexOf(`{${param.wireName}}`);
	return out.sort((a, b) => {
		if (a.in !== b.in) {
			return a.in === "path" ? -1 : 1;
		}
		return a.in === "path" ? routeIndex(a) - routeIndex(b) : 0;
	});
}

/** Returns the JSON body of `method`, or undefined if it sends none. */
function body(method: Method): BodySpec | undefined {
	const json = method.body?.json;
	if (method.body === undefined || json === undefined) {
		return undefined;
	}
	return {
		required: method.body.required,
		description: brief(method.body.description || json.description, FLAG_TEXT),
		fields: objectFields(json.type, 0)
			.filter((field) => !field.readOnly)
			.map((field) => ({
				wireName: field.wireName,
				flag: field.name.kebab(),
				required: field.required,
				description: brief(field.description, FLAG_TEXT),
				type: valueType(field.type, 0),
			})),
	};
}

/**
 * Returns the fields of `type` when it is an object, a model of one, or an
 * intersection of them; none for anything else.
 */
function objectFields(type: Type | undefined, depth: number): readonly Field[] {
	if (type === undefined || depth > MAX_DEPTH) {
		return [];
	}
	switch (type.kind) {
		case "object":
			return type.fields;
		case "model":
			return objectFields(type.model.type, depth + 1);
		case "intersection":
			return type.members.flatMap((member) => objectFields(member, depth + 1));
		case "scalar":
		case "enum":
		case "array":
		case "union":
			return [];
		default:
			return casesHandled(type);
	}
}

/** Returns how the command line takes a value of `type`. */
function valueType(type: Type, depth: number): ValueType {
	if (depth > MAX_DEPTH) {
		return { kind: "json" };
	}
	switch (type.kind) {
		case "scalar":
			switch (type.scalar) {
				case "string":
				case "date":
				case "date-time":
				case "bytes":
					return { kind: "string" };
				case "boolean":
					return { kind: "boolean" };
				case "number":
					return type.number === "float" || type.number === "double" ? { kind: "number" } : { kind: "integer" };
				case "unknown":
				case "null":
				case "binary":
					return { kind: "json" };
				default:
					return casesHandled(type);
			}
		case "enum":
			return { kind: "enum", values: type.values };
		case "array": {
			const elem = valueType(type.elem, depth + 1);
			return elem.kind === "array" ? { kind: "json" } : { kind: "array", elem };
		}
		case "model":
			return valueType(type.model.type, depth + 1);
		case "union": {
			// A nullable value is a union with null: take the value as its other member.
			const members = type.members.filter((member) => !(member.kind === "scalar" && member.scalar === "null"));
			const [only] = members;
			return members.length === 1 && only !== undefined ? valueType(only, depth + 1) : { kind: "json" };
		}
		case "object":
		case "intersection":
			return { kind: "json" };
		default:
			return casesHandled(type);
	}
}

/** Returns the first paragraph of `text`, cut to `max` characters. */
function brief(text: string, max: number): string {
	const paragraph = (text.split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();
	return paragraph.length <= max ? paragraph : `${paragraph.slice(0, max - 1).trimEnd()}…`;
}

function isJsonObject(value: Json | undefined): value is { readonly [key: string]: Json } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the source of the catalogue's module. */
function render(catalog: Catalog): string {
	return [
		"// Generated by generator/plugin.ts from the service's OpenAPI document. Do not edit.",
		'import type { Catalog } from "../../../catalog.ts";',
		"",
		`const catalog: Catalog = ${JSON.stringify(catalog, undefined, "\t")};`,
		"",
		"export default catalog;",
		"",
	].join("\n");
}

/** Fails on a variant the switch above does not handle. */
function casesHandled(unexpected: never): never {
	throw new Error(`unexpected case: ${JSON.stringify(unexpected)}`);
}
