/**
 * Defines the common kind of service: one that authenticates with a header
 * and says its version at one route.
 */
import { Result } from "better-result";
import { z } from "zod";
import type { CatalogLoaders } from "../catalog.ts";
import { UnexpectedResponse, type ContextParam, type Pagination, type ServiceDefinition } from "../service.ts";

/** Where a service says its version, and how to read it from the response. */
export interface VersionRoute {
	readonly route: string;
	/** Returns the version in the response's body, or undefined if it has none. */
	read(body: unknown): string | undefined;
}

/** The options of {@link defineService}. */
export interface ServiceOptions {
	readonly id: string;
	readonly title: string;
	readonly basePath: string;
	readonly versions: CatalogLoaders;
	readonly auth: (apiKey: string) => Readonly<Record<string, string>>;
	readonly credential?: string;
	readonly authOptional?: boolean;
	/** Undefined for services that can't say their version. */
	readonly version?: VersionRoute;
	readonly context?: readonly ContextParam[];
	readonly pagination?: Pagination;
	readonly unwrap?: (body: unknown) => unknown;
	readonly call?: ServiceDefinition["call"];
	/** Asks the server its version itself, for services that can't say it at one route. */
	readonly probe?: ServiceDefinition["probeVersion"];
}

/** Returns the definition of a service with `options`. */
export function defineService(options: ServiceOptions): ServiceDefinition {
	const { version } = options;
	return {
		id: options.id,
		title: options.title,
		basePath: options.basePath,
		versions: options.versions,
		credential: options.credential,
		authOptional: options.authOptional,
		authHeaders: options.auth,
		context: options.context ?? [],
		pagination: options.pagination,
		unwrap: options.unwrap,
		call: options.call,
		probeVersion:
			version === undefined
				? options.probe
				: async (api) => {
						const response = await api.get(version.route);
						if (response.isErr()) {
							return response;
						}
						const found = version.read(response.value);
						if (found === undefined) {
							return Result.err(
								new UnexpectedResponse({
									route: version.route,
									issues: JSON.stringify(response.value)?.slice(0, 200) ?? "",
									message: `${version.route} sent no version`,
								}),
							);
						}
						return Result.ok(found.replace(/^v/i, ""));
					},
	};
}

const ObjectSchema = z.record(z.string(), z.unknown());

/** Returns the string at `path` in `body`, such as `["build", "version"]`, if there is one. */
export function stringAt(body: unknown, path: readonly string[]): string | undefined {
	let current = body;
	for (const key of path) {
		const object = ObjectSchema.safeParse(current);
		if (!object.success) {
			return undefined;
		}
		current = object.data[key];
	}
	return typeof current === "string" && current !== "" ? current : undefined;
}

/** Headers for a key sent as `X-Api-Key` (or another header name). */
export function apiKeyHeader(name = "X-Api-Key") {
	return (apiKey: string) => ({ [name]: apiKey, Accept: "application/json" });
}

/** Headers for a bearer token. */
export function bearer(apiKey: string) {
	return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

/** Returns the number at `key` in `body`, if there is one. */
export function numberAt(body: unknown, key: string): number | undefined {
	const object = ObjectSchema.safeParse(body);
	const value = object.success ? object.data[key] : undefined;
	return typeof value === "number" ? value : undefined;
}
