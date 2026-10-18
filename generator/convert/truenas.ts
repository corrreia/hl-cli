/**
 * Converts TrueNAS's API dump (`middlewared --dump-api`: every method of
 * every API version, with JSON schemas of its parameters and result) to
 * OpenAPI 3.1, one version at a time.
 *
 * TrueNAS's API is JSON-RPC 2.0 over WebSocket, not HTTP routes, so each
 * method becomes `POST /<method>`, its positional parameters become the
 * fields of a JSON body, by name, and `x-hl-rpc` says how to call it: the
 * method, the parameters in order, and whether it's a job. Methods that
 * stream files (`input_pipes`, `output_pipes`) are left out.
 */
import { z } from "zod";

const MethodSchema = z.looseObject({
	name: z.string(),
	doc: z.string().nullable().optional(),
	job: z.boolean().default(false),
	input_pipes: z.boolean().default(false),
	output_pipes: z.boolean().default(false),
	schemas: z.looseObject({
		properties: z.looseObject({
			"Call parameters": z.looseObject({ prefixItems: z.array(z.record(z.string(), z.unknown())).default([]) }),
			"Return value": z.record(z.string(), z.unknown()).optional(),
		}),
	}),
});

const VersionSchema = z.looseObject({ version: z.string(), methods: z.array(MethodSchema) });
const DumpSchema = z.looseObject({ versions: z.array(VersionSchema) });

/** One API version of a dump. */
export type DumpVersion = z.infer<typeof VersionSchema>;

/** The last part of a method name that changes or destroys something, so it asks first. */
const DESTRUCTIVE =
	/^(delete|do_delete|remove|wipe|destroy|rollback|reboot|shutdown|reset|factory_reset|format|detach|export)$/;

/** Returns the API versions in a dump, the output of `middlewared --dump-api`, by version (`25.10.0`). */
export function parseDump(dump: unknown): Map<string, DumpVersion> {
	const parsed = DumpSchema.parse(dump);
	return new Map(parsed.versions.map((version) => [version.version.replace(/^v/, ""), version]));
}

/** Returns the OpenAPI 3.1 document of one API version of TrueNAS. */
export function truenasToOpenApi(api: DumpVersion, version: string): unknown {
	const paths: Record<string, unknown> = {};
	for (const method of api.methods) {
		if (method.input_pipes || method.output_pipes) {
			continue;
		}
		const params = method.schemas.properties["Call parameters"].prefixItems;
		const names = params.map((param, i) =>
			typeof param["title"] === "string" && param["title"] !== "" ? param["title"] : `param${i + 1}`,
		);
		const properties = Object.fromEntries(params.map((param, i) => [names[i], withoutDiscriminators(param)]));
		const required = names.filter((_, i) => !("default" in (params[i] ?? {})));
		const doc = (method.doc ?? "").trim();
		const [summary = ""] = doc.split(/\n\s*\n|\.\s/);
		const last = method.name.split(".").at(-1) ?? "";
		paths[`/${method.name}`] = {
			post: {
				summary: summary.replace(/\s+/g, " ").replace(/\.$/, ""),
				description: doc,
				// Undefined values are left out of the JSON.
				requestBody:
					names.length === 0
						? undefined
						: {
								required: required.length > 0,
								content: {
									"application/json": {
										schema: { type: "object", properties, required: required.length > 0 ? required : undefined },
									},
								},
							},
				responses: {
					"200": {
						description: "The result",
						content: {
							"application/json": { schema: withoutDiscriminators(method.schemas.properties["Return value"] ?? {}) },
						},
					},
				},
				"x-hl-rpc": {
					method: method.name,
					params: names,
					job: method.job,
					defaults: Object.fromEntries(
						params.flatMap((param, i) => ("default" in param ? [[names[i], param["default"]]] : [])),
					),
				},
				"x-forge-require-confirmation": DESTRUCTIVE.test(last) ? "" : undefined,
			},
		};
	}
	return {
		openapi: "3.1.0",
		info: { title: "TrueNAS API", version },
		servers: [{ url: `/api/v${version}` }],
		paths,
	};
}

/**
 * Returns `schema` without `discriminator`s. The dump inlines every
 * definition and drops the `$defs` table, but leaves discriminators mapping
 * to `#/$defs/…`, which lead nowhere; the unions themselves are kept.
 */
function withoutDiscriminators(schema: unknown): unknown {
	if (Array.isArray(schema)) {
		return schema.map(withoutDiscriminators);
	}
	if (typeof schema !== "object" || schema === null) {
		return schema;
	}
	return Object.fromEntries(
		Object.entries(schema)
			.filter(([key]) => key !== "discriminator")
			.map(([key, value]) => [key, withoutDiscriminators(value)]),
	);
}
