/**
 * Runs `hl` in tests: a session with recorded output, a clock the test
 * moves, a config file in a temporary directory, and an answer for
 * confirmation prompts.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../cli.ts";
import { loadConfig } from "../config.ts";
import { Result } from "better-result";
import { NoKeyring, type Keyring, type SecretUnavailable } from "../secrets.ts";
import type { ServiceDefinition } from "../service.ts";
import type { Session } from "../session.ts";

/** What one run printed and returned. */
export interface RunResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	/** The questions it asked. */
	readonly asked: readonly string[];
}

/** The options of one run. */
export interface RunOptions {
	/** Standard input. */
	readonly stdin?: string;
	/** The answer to confirmations; undefined for no terminal to ask on. */
	readonly confirm?: boolean;
	/** Whether standard output is a terminal. */
	readonly tty?: boolean;
	/** What's typed when hl asks for a secret; undefined for no terminal to ask on. */
	readonly secret?: string;
}

/** A keyring in memory, whose keys tests can read. */
export class MemoryKeyring implements Keyring {
	readonly name = "test keyring";
	/** The keys, by account. */
	readonly keys = new Map<string, string>();

	/** Returns the key under `account`, if there is one. */
	get(account: string): Promise<Result<string | undefined, SecretUnavailable>> {
		return Promise.resolve(Result.ok(this.keys.get(account)));
	}

	/** Keeps `value` under `account`. */
	set(account: string, value: string): Promise<Result<void, SecretUnavailable>> {
		this.keys.set(account, value);
		return Promise.resolve(Result.ok(undefined));
	}

	/** Forgets the key under `account`. */
	delete(account: string): Promise<Result<void, SecretUnavailable>> {
		this.keys.delete(account);
		return Promise.resolve(Result.ok(undefined));
	}
}

/** The options of {@link createTestHomelab}. */
export interface TestHomelabOptions {
	readonly env?: NodeJS.ProcessEnv;
	/** The keyring; none, as on a machine without one, when null. */
	readonly keyring?: MemoryKeyring | null;
}

/** A homelab in a test: a config file, a clock, the services, and a keyring. */
export interface TestHomelab {
	readonly configPath: string;
	/** The keyring, unless the homelab has none. */
	readonly keyring: MemoryKeyring | undefined;
	/** The current time; tests move it. */
	now: Date;
	run(args: readonly string[], options?: RunOptions): Promise<RunResult>;
	/** Returns the config file's JSON. */
	readConfig(): Promise<unknown>;
}

/** Returns a homelab with no instances, driving `services`. */
export async function createTestHomelab(
	services: readonly ServiceDefinition[],
	options: TestHomelabOptions = {},
): Promise<TestHomelab> {
	const env = options.env ?? {};
	const keyring = options.keyring === null ? undefined : (options.keyring ?? new MemoryKeyring());
	const dir = await mkdtemp(join(tmpdir(), "hl-test-"));
	const configPath = join(dir, "config.json");
	const homelab: TestHomelab = {
		configPath,
		keyring,
		now: new Date("2026-10-18T12:00:00Z"),
		async run(args, options = {}) {
			let stdout = "";
			let stderr = "";
			const asked: string[] = [];
			const loaded = await loadConfig(configPath);
			if (loaded.isErr()) {
				throw new Error(loaded.error.message);
			}
			const session: Session = {
				io: {
					stdout: { write: (text) => void (stdout += text), isTTY: options.tty ?? false },
					stderr: { write: (text) => void (stderr += text), isTTY: false },
					readStdin: () => Promise.resolve(options.stdin ?? ""),
					confirm: (question) => {
						asked.push(question);
						return Promise.resolve(options.confirm);
					},
					askSecret: (question) => {
						asked.push(question);
						return Promise.resolve(options.secret);
					},
				},
				env,
				now: () => homelab.now,
				configPath,
				config: loaded.value,
				keyring: () =>
					Promise.resolve(
						keyring === undefined
							? Result.err(new NoKeyring({ message: "the test has no keyring" }))
							: Result.ok(keyring),
					),
				services,
				exitCode: 0,
			};
			const code = await main(args, session);
			return { code, stdout, stderr, asked };
		},
		async readConfig() {
			const text = await readFile(configPath, "utf8");
			const value: unknown = JSON.parse(text);
			return value;
		},
	};
	return homelab;
}
