/**
 * One run of `hl`: its input and output, environment, clock, and the
 * configuration it reads and saves.
 */
import type { Result } from "better-result";
import { saveConfig, type Config, type ConfigIoFailed } from "./config.ts";
import type { HttpError } from "./http.ts";
import type { Keyring, NoKeyring } from "./secrets.ts";
import type { Instance } from "./instances.ts";
import { versionIsStale } from "./instances.ts";
import type { ServiceDefinition, UnexpectedResponse } from "./service.ts";

/** Something to write text to. */
export interface Output {
	write(text: string): void;
	/** Whether it is a terminal. */
	readonly isTTY: boolean;
}

/** Where a run reads from and writes to. */
export interface Io {
	readonly stdout: Output;
	readonly stderr: Output;
	/** Reads all of standard input. */
	readStdin(): Promise<string>;
	/** Asks a yes-or-no question on the terminal; undefined when there is no terminal to ask on. */
	confirm(question: string): Promise<boolean | undefined>;
	/** Asks for a secret on the terminal, without showing what's typed; undefined when there is no terminal. */
	askSecret(question: string): Promise<string | undefined>;
}

/** One run of `hl`. */
export interface Session {
	readonly io: Io;
	readonly env: NodeJS.ProcessEnv;
	readonly now: () => Date;
	readonly configPath: string;
	/** The configuration, as last saved. */
	config: Config;
	/** The system keyring, for keys kept there; loaded only when one is needed. */
	keyring(): Promise<Result<Keyring, NoKeyring>>;
	/** The services `hl` can drive. */
	readonly services: readonly ServiceDefinition[];
	/** The exit code commands set. */
	exitCode: number;
}

/** Saves `config` as the session's configuration. */
export async function updateConfig(session: Session, config: Config): Promise<Result<void, ConfigIoFailed>> {
	const saved = await saveConfig(session.configPath, config);
	if (saved.isOk()) {
		session.config = config;
	}
	return saved;
}

/** The version an instance runs, as far as `hl` knows it. */
export interface KnownVersion {
	/** Undefined when the server has never answered. */
	readonly version: string | undefined;
	/** Why the server couldn't be asked just now, if it couldn't. */
	readonly probeError: HttpError | UnexpectedResponse | undefined;
}

/**
 * Returns the version `instance` runs: the one saved, or, when that is
 * missing or stale (or `force`), the one the server reports now, which is
 * saved. A server that doesn't answer leaves the saved version in use.
 */
export async function knownVersion(session: Session, instance: Instance, force = false): Promise<KnownVersion> {
	if (instance.config.pinnedVersion !== undefined) {
		return { version: instance.config.pinnedVersion, probeError: undefined };
	}
	const saved = instance.config.detected?.version;
	const probe = instance.service.probeVersion;
	if (probe === undefined || (!force && !versionIsStale(instance.config, session.now()))) {
		return { version: saved, probeError: undefined };
	}
	const probed = await probe(instance.api);
	if (probed.isErr()) {
		return { version: saved, probeError: probed.error };
	}
	const instances = session.config.instances[instance.service.id] ?? {};
	const current = instances[instance.name];
	if (current !== undefined) {
		const detected = { version: probed.value, at: session.now().toISOString() };
		const next: Config = {
			...session.config,
			instances: {
				...session.config.instances,
				[instance.service.id]: { ...instances, [instance.name]: { ...current, detected } },
			},
		};
		// The saved version is a cache: failing to write it doesn't fail the command.
		const saved = await updateConfig(session, next);
		if (saved.isErr()) {
			session.io.stderr.write(`⚠ ${saved.error.message}; the detected version is not saved\n`);
		}
	}
	return { version: probed.value, probeError: undefined };
}
