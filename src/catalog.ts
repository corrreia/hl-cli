/**
 * The command catalogue of one version of a service's API, as the forge
 * plugin in `generator/` writes it from the service's OpenAPI document.
 *
 * It is plain data: the runtime builds yargs commands from it, after it
 * knows which instance, and so which version, a command is for.
 */

/** The type of a value a command takes, as far as the command line needs it. */
export type ValueType =
	| { readonly kind: "string" }
	| { readonly kind: "integer" }
	| { readonly kind: "number" }
	| { readonly kind: "boolean" }
	| { readonly kind: "enum"; readonly values: readonly (string | number | boolean)[] }
	| { readonly kind: "array"; readonly elem: ValueType }
	/** Anything else: objects, unions and unknowns, passed as JSON. */
	| { readonly kind: "json" };

/** A path or query parameter of an operation. */
export interface ParamSpec {
	/** The name as it is sent, such as `siteId`. */
	readonly wireName: string;
	/** The name on the command line, in kebab case, such as `site-id`. */
	readonly flag: string;
	readonly in: "path" | "query";
	readonly required: boolean;
	readonly description: string;
	readonly type: ValueType;
}

/** A top-level property of a JSON request body. */
export interface BodyFieldSpec {
	readonly wireName: string;
	readonly flag: string;
	readonly required: boolean;
	readonly description: string;
	readonly type: ValueType;
}

/** The JSON request body of an operation. */
export interface BodySpec {
	readonly required: boolean;
	readonly description: string;
	/**
	 * The body's top-level properties, when its schema is one object;
	 * empty for unions and other shapes, which only `--body` can send.
	 */
	readonly fields: readonly BodyFieldSpec[];
}

/** One operation of the API, as one command. */
export interface CommandSpec {
	/** The words of the command after the service, such as `["firewall", "policies", "list"]`. */
	readonly path: readonly string[];
	readonly summary: string;
	readonly description: string;
	/** Such as `GET`. */
	readonly method: string;
	/** The path template, relative to the service's base URL, such as `/v1/sites/{siteId}/devices`. */
	readonly route: string;
	readonly params: readonly ParamSpec[];
	readonly body?: BodySpec | undefined;
	/** The sentence to confirm before calling a destructive operation, or undefined if it needs none. */
	readonly confirmation?: string | undefined;
	readonly hidden: boolean;
	readonly deprecated: boolean;
}

/** A group of commands, such as `firewall policies`. */
export interface GroupSpec {
	readonly path: readonly string[];
	readonly description: string;
}

/** Every command of one version of a service's API. */
export interface Catalog {
	/** The version of the API document, `info.version`. */
	readonly version: string;
	readonly groups: readonly GroupSpec[];
	readonly commands: readonly CommandSpec[];
}

/** Loads the catalogue of each bundled version of a service, by version. */
export type CatalogLoaders = Readonly<Record<string, () => Promise<{ readonly default: Catalog }>>>;
