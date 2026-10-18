/**
 * The user's configuration: the instances of each service, and which one
 * is the default. It is kept as JSON at `$HL_CONFIG`, or
 * `$XDG_CONFIG_HOME/hl/config.json`, readable only by the user since it
 * holds API keys.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Result, TaggedError } from "better-result";
import { z } from "zod";
import { SecretSchema } from "./secrets.ts";

/** A name for an instance: lower-case letters, digits and dashes. */
export const InstanceNameSchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]*$/, "use lower-case letters, digits and dashes, starting with a letter or digit");

/** The version a server reported, and when. */
const DetectedSchema = z.strictObject({
	version: z.string().min(1),
	at: z.iso.datetime(),
});

/** One server of a service. */
const InstanceSchema = z.strictObject({
	url: z.url({ protocol: /^https?$/ }),
	/** Where its API key is; none for servers that don't ask for one. */
	secret: SecretSchema.optional(),
	insecure: z.boolean().default(false),
	basePath: z.string().startsWith("/").optional(),
	/** Default values of the service's context flags, such as UniFi's `site`, by flag. */
	context: z.record(z.string(), z.string().min(1)).default({}),
	detected: DetectedSchema.optional(),
	/** The version to use, for servers that can't be asked or to override what they say. */
	pinnedVersion: z.string().min(1).optional(),
});

const ConfigSchema = z.strictObject({
	instances: z.record(z.string(), z.record(InstanceNameSchema, InstanceSchema)).default({}),
	defaults: z.record(z.string(), InstanceNameSchema).default({}),
});

/** One server of a service, as it is configured. */
export type InstanceConfig = z.infer<typeof InstanceSchema>;

/** The whole configuration. */
export type Config = z.infer<typeof ConfigSchema>;

/** The configuration file is not JSON, or not a configuration. */
export class InvalidConfig extends TaggedError("InvalidConfig")<{
	readonly path: string;
	readonly issues: string;
	readonly message: string;
}> {}

/** The configuration file could not be read or written. */
export class ConfigIoFailed extends TaggedError("ConfigIoFailed")<{
	readonly path: string;
	readonly operation: "read" | "write";
	readonly cause: unknown;
	readonly message: string;
}> {}

/** Returns where the configuration is kept, from the environment. */
export function configPath(env: NodeJS.ProcessEnv): string {
	const explicit = env["HL_CONFIG"];
	if (explicit !== undefined && explicit !== "") {
		return explicit;
	}
	const base = env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
	return join(base, "hl", "config.json");
}

/** Returns an empty configuration. */
export function emptyConfig(): Config {
	return { instances: {}, defaults: {} };
}

/** Reads the configuration at `path`; an empty one if there is no file. */
export async function loadConfig(path: string): Promise<Result<Config, InvalidConfig | ConfigIoFailed>> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (cause: unknown) {
		if (isMissingFile(cause)) {
			return Result.ok(emptyConfig());
		}
		return Result.err(new ConfigIoFailed({ path, operation: "read", cause, message: `Could not read ${path}` }));
	}
	return parseConfig(path, text);
}

/** Parses the text of a configuration file. */
export function parseConfig(path: string, text: string): Result<Config, InvalidConfig> {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return Result.err(new InvalidConfig({ path, issues: "not JSON", message: `${path} is not valid JSON` }));
	}
	const parsed = ConfigSchema.safeParse(raw);
	if (!parsed.success) {
		const issues = z.prettifyError(parsed.error);
		return Result.err(new InvalidConfig({ path, issues, message: `${path} is not a valid hl config:\n${issues}` }));
	}
	return Result.ok(parsed.data);
}

/** Writes `config` to `path`, replacing the file in one step, readable only by the user. */
export async function saveConfig(path: string, config: Config): Promise<Result<void, ConfigIoFailed>> {
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await writeFile(temporary, `${JSON.stringify(config, undefined, "\t")}\n`, { mode: 0o600 });
		await rename(temporary, path);
		return Result.ok(undefined);
	} catch (cause: unknown) {
		return Result.err(new ConfigIoFailed({ path, operation: "write", cause, message: `Could not write ${path}` }));
	}
}

function isMissingFile(cause: unknown): boolean {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}
