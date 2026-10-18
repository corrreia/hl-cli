/**
 * What `hl` knows about a service that its OpenAPI document doesn't say:
 * where the API lives on a server, how to authenticate, how to ask for the
 * version, which parameters come from context, and how pages work.
 */
import { TaggedError, type Result } from "better-result";
import type { CatalogLoaders, CommandSpec } from "./catalog.ts";
import type { HttpError } from "./http.ts";
import type { VersionMatch } from "./version.ts";

/** How to reach one instance, for services that don't speak HTTP routes. */
export interface Connection {
	/** The instance's URL, such as `https://truenas.lan`. */
	readonly url: string;
	readonly insecure: boolean;
	/** The key, in memory only; undefined for instances without one. */
	readonly apiKey: string | undefined;
}

/** Requests to one instance's API, by route relative to its base URL. */
export interface ServiceApi {
	get(route: string, query?: Readonly<Record<string, string>>): Promise<Result<unknown, HttpError>>;
	readonly connection: Connection;
}

/** A failure of a service's own way of calling, as a JSON-RPC call. */
export interface CallError {
	readonly message: string;
}

/** A response did not have the shape the service definition expects. */
export class UnexpectedResponse extends TaggedError("UnexpectedResponse")<{
	readonly route: string;
	readonly issues: string;
	readonly message: string;
}> {}

/** A context parameter has no value, or the value given matches nothing. */
export class ContextUnresolved extends TaggedError("ContextUnresolved")<{
	readonly flag: string;
	readonly message: string;
}> {}

/**
 * A path parameter that most commands share and that is taken from context
 * instead of a positional argument, such as UniFi's `siteId` from `--site`.
 */
export interface ContextParam {
	/** The parameter's name as it is sent. */
	readonly wireName: string;
	/** The flag that sets it. */
	readonly flag: string;
	readonly description: string;
	/**
	 * Returns the value to send: from `given` (the flag), else from the
	 * instance's default, else from the server when only one choice exists.
	 */
	resolve(
		api: ServiceApi,
		given: string | undefined,
		instanceDefault: string | undefined,
	): Promise<Result<string, ContextUnresolved | HttpError | UnexpectedResponse>>;
}

/** How the service pages lists, for `--all-pages`. */
export interface Pagination {
	/** The query parameters of the page's offset and size. */
	readonly offsetParam: string;
	readonly limitParam: string;
	/** The largest page the server sends. */
	readonly maxLimit: number;
	/** Returns the items of a page, and how many there are in all if the page says. */
	page(
		body: unknown,
	): Result<{ readonly items: readonly unknown[]; readonly total: number | undefined }, UnexpectedResponse>;
}

/** A service `hl` can drive. */
export interface ServiceDefinition {
	/** The command name, such as `unifi`. */
	readonly id: string;
	/** The product name, such as `UniFi Network`. */
	readonly title: string;
	/** What to add to an instance's URL to reach the API, unless the instance sets its own. */
	readonly basePath: string;
	/** The catalogue of every bundled version of the API. */
	readonly versions: CatalogLoaders;
	/** How to describe the key `--api-key` takes, such as `API key` or `user:password`. */
	readonly credential?: string | undefined;
	/** Whether instances can have no key, for servers that don't ask for one. */
	readonly authOptional?: boolean | undefined;
	/** Returns the headers that authenticate a request with `apiKey`. */
	authHeaders(apiKey: string): Readonly<Record<string, string>>;
	/**
	 * Asks the server which version of the API it runs; undefined when the
	 * service has no way to say, and an instance's version is pinned or the
	 * newest is used.
	 */
	readonly probeVersion?:
		| ((api: ServiceApi) => Promise<Result<string, HttpError | UnexpectedResponse | CallError>>)
		| undefined;
	readonly context: readonly ContextParam[];
	readonly pagination?: Pagination | undefined;
	/** Returns what to print of a response's body, for services that wrap every response, as in `{ data }`. */
	readonly unwrap?: ((body: unknown) => unknown) | undefined;
	/**
	 * Calls a command that has `rpc` (a JSON-RPC method) instead of an HTTP
	 * route, with its body fields as the parameters, on the API version its
	 * catalogue is from; `match` is how that relates to the server's version,
	 * when it's known.
	 */
	readonly call?:
		| ((
				api: ServiceApi,
				command: CommandSpec,
				body: unknown,
				version: string,
				match: VersionMatch | undefined,
		  ) => Promise<Result<unknown, CallError>>)
		| undefined;
}
