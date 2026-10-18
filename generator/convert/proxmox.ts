/**
 * Converts the API schema Proxmox ships in its API viewer (`apidoc.js`, a
 * tree of paths, each with the JSON schema of its methods) to OpenAPI 3.
 *
 * GET and DELETE parameters become query parameters, POST and PUT ones a
 * JSON body. Responses are wrapped as Proxmox sends them, in `{ data }`.
 * Numbered properties such as `net[n]` become `net0` to `net7`; higher
 * numbers can still be sent with `--body`.
 */
import { z } from "zod";

/** How many of a numbered property, such as `net[n]`, get properties of their own. */
const NUMBERED = 8;

// Proxmox's schema is loosely typed (bounds and flags are sometimes strings),
// so its scalar fields are read as they come and checked where they're used.
const SchemaSchema: z.ZodType<PveSchema> = z.lazy(() =>
	z.looseObject({
		type: z.unknown().optional(),
		description: z.unknown().optional(),
		optional: z.unknown().optional(),
		default: z.unknown().optional(),
		enum: z.unknown().optional(),
		minimum: z.unknown().optional(),
		maximum: z.unknown().optional(),
		items: SchemaSchema.optional(),
		properties: z.record(z.string(), SchemaSchema).optional(),
	}),
);

/** A JSON schema as Proxmox writes it. */
interface PveSchema {
	readonly type?: unknown;
	readonly description?: unknown;
	readonly optional?: unknown;
	readonly default?: unknown;
	readonly enum?: unknown;
	readonly minimum?: unknown;
	readonly maximum?: unknown;
	readonly items?: PveSchema | undefined;
	readonly properties?: Readonly<Record<string, PveSchema>> | undefined;
}

const MethodSchema = z.looseObject({
	description: z.string().default(""),
	parameters: SchemaSchema.optional(),
	returns: SchemaSchema.optional(),
});

interface PveNode {
	readonly path: string;
	readonly info?: Readonly<Record<string, unknown>> | undefined;
	readonly children?: readonly PveNode[] | undefined;
}

const NodeSchema: z.ZodType<PveNode> = z.lazy(() =>
	z.looseObject({
		path: z.string(),
		info: z.record(z.string(), z.unknown()).optional(),
		children: z.array(NodeSchema).optional(),
	}),
);

/** Returns the schema tree in the text of `apidoc.js`. */
export function parseApidoc(text: string): readonly PveNode[] {
	const start = text.indexOf("[", text.search(/(apiSchema|pveapi)\s*=/));
	// The array ends at the first line that is only `]` (or `];`) and parses.
	for (const match of text.slice(start).matchAll(/\n\];?\s*\n/g)) {
		const candidate = text.slice(start, start + match.index + 2);
		try {
			return z.array(NodeSchema).parse(JSON.parse(candidate));
		} catch {
			continue;
		}
	}
	throw new Error("apidoc.js has no API schema");
}

/** Returns the OpenAPI 3 document of the Proxmox VE API in `text`, the content of `apidoc.js`. */
export function proxmoxToOpenApi(text: string, version: string): unknown {
	const paths: Record<string, Record<string, unknown>> = {};
	const visit = (node: PveNode) => {
		for (const [method, raw] of Object.entries(node.info ?? {})) {
			const info = MethodSchema.parse(raw);
			(paths[node.path] ??= {})[method.toLowerCase()] = operation(node.path, method, info);
		}
		for (const child of node.children ?? []) {
			visit(child);
		}
	};
	for (const node of parseApidoc(text)) {
		visit(node);
	}
	return {
		openapi: "3.0.3",
		info: { title: "Proxmox VE API", version },
		servers: [{ url: "/api2/json" }],
		paths,
	};
}

function operation(path: string, method: string, info: z.infer<typeof MethodSchema>): Record<string, unknown> {
	const pathNames = new Set([...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? ""));
	const properties = numbered(info.parameters?.properties ?? {});
	const parameters: unknown[] = [];
	const body: Record<string, unknown> = {};
	const required: string[] = [];
	const inQuery = method === "GET" || method === "DELETE";
	for (const [name, schema] of Object.entries(properties)) {
		const isRequired = !(schema.optional === 1 || schema.optional === true || schema.optional === "1");
		const description = typeof schema.description === "string" ? schema.description : undefined;
		if (pathNames.has(name)) {
			parameters.push({ name, in: "path", required: true, description, schema: convert(schema) });
		} else if (inQuery) {
			parameters.push({ name, in: "query", required: isRequired, description, schema: convert(schema) });
		} else {
			body[name] = { ...convert(schema), description };
			if (isRequired) {
				required.push(name);
			}
		}
	}
	// Path parameters the schema doesn't describe are strings.
	for (const name of pathNames) {
		if (!(name in properties)) {
			parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
		}
	}
	const [summary = ""] = info.description.split("\n");
	// Proxmox's own method names, such as `index`, repeat across paths, so
	// operations have no operationId and are named from their paths.
	return {
		summary,
		description: info.description,
		parameters,
		// Undefined values are left out of the JSON.
		requestBody:
			Object.keys(body).length === 0
				? undefined
				: {
						required: required.length > 0,
						content: {
							"application/json": {
								schema: { type: "object", properties: body, required: required.length > 0 ? required : undefined },
							},
						},
					},
		responses: {
			"200": {
				description: "OK",
				content: {
					"application/json": { schema: { type: "object", properties: { data: convert(info.returns ?? {}) } } },
				},
			},
		},
	};
}

/** Returns `properties` with each numbered one, such as `net[n]`, as `net0` to `net7`. */
function numbered(properties: Readonly<Record<string, PveSchema>>): Record<string, PveSchema> {
	const out: Record<string, PveSchema> = {};
	for (const [name, schema] of Object.entries(properties)) {
		const base = /^(.+)\[n\]$/.exec(name)?.[1];
		if (base === undefined) {
			out[name] = schema;
			continue;
		}
		for (let i = 0; i < NUMBERED; i++) {
			out[`${base}${i}`] = schema;
		}
	}
	return out;
}

/** Returns a Proxmox JSON schema as an OpenAPI one. */
function convert(schema: PveSchema): Record<string, unknown> {
	const types: unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
	const type = types.find((t) => t !== "null");
	const out: Record<string, unknown> = {};
	switch (type) {
		case "string":
		case "integer":
		case "number":
		case "boolean":
			out["type"] = type;
			break;
		case "array":
			out["type"] = "array";
			out["items"] = convert(schema.items ?? {});
			break;
		case "object":
			out["type"] = "object";
			if (schema.properties !== undefined) {
				out["properties"] = Object.fromEntries(
					Object.entries(schema.properties).map(([key, value]) => [key, convert(value)]),
				);
			}
			break;
		default:
			// `null`, `any`, or unsaid: any value.
			break;
	}
	if (Array.isArray(schema.enum) && (type === "string" || type === "integer" || type === "number")) {
		out["enum"] = schema.enum.filter((value) => typeof value === "string" || typeof value === "number");
	}
	const minimum = Number(schema.minimum);
	const maximum = Number(schema.maximum);
	if (schema.minimum !== undefined && Number.isFinite(minimum)) {
		out["minimum"] = minimum;
	}
	if (schema.maximum !== undefined && Number.isFinite(maximum)) {
		out["maximum"] = maximum;
	}
	if (schema.default !== undefined && (typeof schema.default !== "object" || schema.default === null)) {
		out["default"] = schema.default;
	}
	return out;
}
