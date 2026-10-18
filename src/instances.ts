/**
 * Instances: which server of a service a command is for, how to talk to it,
 * which version it runs, and so which catalogue its commands come from.
 */
import { Result, TaggedError } from "better-result";
import type { Catalog } from "./catalog.ts";
import type { Config, InstanceConfig } from "./config.ts";
import { createHttpClient, type HttpClient } from "./http.ts";
import { resolveSecret, type SecretContext } from "./secrets.ts";
import type { ServiceApi, ServiceDefinition } from "./service.ts";
import { newestVersion, pickVersion, type VersionMatch } from "./version.ts";

/** How long a detected version is trusted before the server is asked again. */
export const VERSION_TTL_MS = 24 * 60 * 60 * 1000;

/** How long to wait for a server, in milliseconds. */
const TIMEOUT_MS = 15_000;

/** A service has no instances configured. */
export class NoInstances extends TaggedError("NoInstances")<{
	readonly service: string;
	readonly message: string;
}> {}

/** The instance asked for is not configured. */
export class UnknownInstance extends TaggedError("UnknownInstance")<{
	readonly service: string;
	readonly name: string;
	readonly message: string;
}> {}

/** A service has several instances and none is the default. */
export class NoDefaultInstance extends TaggedError("NoDefaultInstance")<{
	readonly service: string;
	readonly names: readonly string[];
	readonly message: string;
}> {}

/** An instance has no API key, or its key can't be had from where it is kept. */
export class MissingApiKey extends TaggedError("MissingApiKey")<{
	readonly service: string;
	readonly name: string;
	readonly message: string;
}> {}

/** An instance, chosen by name. */
export interface SelectedInstance {
	readonly name: string;
	readonly config: InstanceConfig;
}

/** An instance ready to send requests to. */
export interface Instance extends SelectedInstance {
	readonly service: ServiceDefinition;
	readonly baseUrl: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly http: HttpClient;
	readonly api: ServiceApi;
}

/** Returns the names of a service's instances, sorted. */
export function instanceNames(config: Config, service: string): string[] {
	return Object.keys(config.instances[service] ?? {}).sort();
}

/**
 * Returns the instance named `requested`, or else the service's default,
 * or else its only instance.
 */
export function selectInstance(
	config: Config,
	service: ServiceDefinition,
	requested: string | undefined,
): Result<SelectedInstance, NoInstances | UnknownInstance | NoDefaultInstance> {
	const instances = config.instances[service.id] ?? {};
	const names = instanceNames(config, service.id);
	const addHint = `hl instances add ${service.id} <name> --url <url> --api-key <key>`;
	if (names.length === 0) {
		return Result.err(
			new NoInstances({ service: service.id, message: `No ${service.title} instances yet; add one with: ${addHint}` }),
		);
	}
	const name = requested ?? config.defaults[service.id] ?? (names.length === 1 ? names[0] : undefined);
	if (name === undefined) {
		return Result.err(
			new NoDefaultInstance({
				service: service.id,
				names,
				message: `${service.title} has ${names.length} instances (${names.join(", ")}); pick one with ${service.id}@<name>, or set a default with: hl instances use ${service.id} <name>`,
			}),
		);
	}
	const instance = instances[name];
	if (instance === undefined) {
		return Result.err(
			new UnknownInstance({
				service: service.id,
				name,
				message: `No ${service.id} instance named "${name}"; instances: ${names.join(", ")}`,
			}),
		);
	}
	return Result.ok({ name, config: instance });
}

/**
 * Returns `selected`, ready to send requests to, with its key from where it
 * is kept: the keyring, a command, the environment, or the config file.
 */
export async function connect(
	service: ServiceDefinition,
	selected: SelectedInstance,
	secrets: SecretContext,
): Promise<Result<Instance, MissingApiKey>> {
	const { secret } = selected.config;
	const label = `${service.id}@${selected.name}`;
	if (secret === undefined) {
		return service.authOptional === true
			? Result.ok(connectWithKey(service, selected, undefined))
			: Result.err(new MissingApiKey({ service: service.id, name: selected.name, message: `${label} has no API key` }));
	}
	const apiKey = await resolveSecret(secret, secrets);
	if (apiKey.isErr()) {
		return Result.err(
			new MissingApiKey({ service: service.id, name: selected.name, message: `${label}: ${apiKey.error.message}` }),
		);
	}
	return Result.ok(connectWithKey(service, selected, apiKey.value));
}

/** Returns `selected`, ready to send requests to with `apiKey`, or with none. */
export function connectWithKey(
	service: ServiceDefinition,
	selected: SelectedInstance,
	apiKey: string | undefined,
): Instance {
	const { config } = selected;
	const baseUrl = `${config.url.replace(/\/+$/, "")}${config.basePath ?? service.basePath}`;
	const headers = apiKey === undefined ? { Accept: "application/json" } : service.authHeaders(apiKey);
	const http = createHttpClient({ insecure: config.insecure, timeoutMs: TIMEOUT_MS });
	const api: ServiceApi = {
		async get(route, query) {
			const response = await http.send({ method: "GET", url: buildUrl(baseUrl, route, query ?? {}), headers });
			return response.map((r) => r.body);
		},
	};
	return { ...selected, service, baseUrl, headers, http, api };
}

/** Returns the URL of `route` under `baseUrl`, with `query`. */
export function buildUrl(
	baseUrl: string,
	route: string,
	query: Readonly<Record<string, string | readonly string[]>>,
): URL {
	const url = new URL(`${baseUrl}${route}`);
	for (const [key, value] of Object.entries(query)) {
		for (const item of typeof value === "string" ? [value] : value) {
			url.searchParams.append(key, item);
		}
	}
	return url;
}

/** Whether the version saved for `instance` is missing or older than {@link VERSION_TTL_MS}. */
export function versionIsStale(instance: InstanceConfig, now: Date): boolean {
	if (instance.detected === undefined) {
		return true;
	}
	return now.getTime() - Date.parse(instance.detected.at) > VERSION_TTL_MS;
}

/** The catalogue of commands for an instance, and how it matches the server. */
export interface CatalogChoice {
	readonly catalog: Catalog;
	/** Undefined when the server's version is not known, and the newest catalogue is used. */
	readonly match: VersionMatch | undefined;
}

/** Loads the catalogue for a server running `serverVersion`, or the newest if it's not known. */
export async function loadCatalog(
	service: ServiceDefinition,
	serverVersion: string | undefined,
): Promise<CatalogChoice> {
	const available = Object.keys(service.versions);
	const match = serverVersion === undefined ? undefined : pickVersion(available, serverVersion);
	const version = match?.version ?? newestVersion(available);
	const loader = service.versions[version];
	if (loader === undefined) {
		throw new Error(`no catalogue loader for ${service.id} ${version}`);
	}
	const module = await loader();
	return { catalog: module.default, match };
}
