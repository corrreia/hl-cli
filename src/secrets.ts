/**
 * Where an instance's API key is kept, and how to get it back:
 *
 * - `keyring`: the system keyring (Secret Service on Linux through
 *   `secret-tool`, the login Keychain on macOS through `security`), under
 *   the service `hl` and the account `<service>/<instance>`.
 * - `command`: a command that prints the key, such as `pass show unifi`.
 * - `env`: an environment variable that holds the key.
 * - `file`: the key itself, in the config file, as asked for with
 *   `--store-in-config`.
 *
 * Keys never go into errors or logs.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Result, TaggedError } from "better-result";
import { z } from "zod";

const run = promisify(execFile);

/** The keyring service every key is stored under. */
const KEYRING_SERVICE = "hl";

/** How long a key command may take. */
const COMMAND_TIMEOUT_MS = 60_000;

/** Where an instance's key is. */
export const SecretSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("keyring"), account: z.string().min(1) }),
	z.strictObject({ kind: z.literal("command"), command: z.string().min(1) }),
	z.strictObject({ kind: z.literal("env"), name: z.string().min(1) }),
	z.strictObject({ kind: z.literal("file"), value: z.string().min(1) }),
]);

/** Where an instance's key is. */
export type Secret = z.infer<typeof SecretSchema>;

/** The key couldn't be had: not in the keyring, the command failed, or the variable isn't set. */
export class SecretUnavailable extends TaggedError("SecretUnavailable")<{
	readonly kind: Secret["kind"];
	readonly message: string;
	readonly cause?: unknown;
}> {}

/** There is no system keyring to keep keys in. */
export class NoKeyring extends TaggedError("NoKeyring")<{
	readonly message: string;
}> {}

/** A system keyring. */
export interface Keyring {
	/** A name for messages, such as `Secret Service`. */
	readonly name: string;
	/** Returns the key under `account`, or undefined if there is none. */
	get(account: string): Promise<Result<string | undefined, SecretUnavailable>>;
	set(account: string, value: string): Promise<Result<void, SecretUnavailable>>;
	delete(account: string): Promise<Result<void, SecretUnavailable>>;
}

/** Returns the keyring of this system, or why there is none. */
export async function systemKeyring(platform: NodeJS.Platform = process.platform): Promise<Result<Keyring, NoKeyring>> {
	if (platform === "darwin" && (await found("security"))) {
		return Result.ok(macKeychain);
	}
	if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
		if (!(await found("secret-tool"))) {
			return Result.err(
				new NoKeyring({
					message: "secret-tool isn't installed (it's in libsecret: libsecret-tools on Debian, libsecret on Arch)",
				}),
			);
		}
		return Result.ok(secretService);
	}
	return Result.err(new NoKeyring({ message: `hl can't use the keyring on ${platform}` }));
}

/** The Secret Service (GNOME Keyring, KWallet, KeePassXC), through `secret-tool`. */
const secretService: Keyring = {
	name: "Secret Service",
	async get(account) {
		try {
			const { stdout } = await run("secret-tool", ["lookup", "service", KEYRING_SERVICE, "account", account]);
			return Result.ok(stdout === "" ? undefined : stdout.replace(/\n$/, ""));
		} catch (cause: unknown) {
			// `lookup` exits with 1, and prints nothing, when there's no such key.
			if (exitCode(cause) === 1 && stderrOf(cause) === "") {
				return Result.ok(undefined);
			}
			return Result.err(
				new SecretUnavailable({
					kind: "keyring",
					message: `The Secret Service failed: ${stderrOf(cause) || "is it running?"}`,
					cause,
				}),
			);
		}
	},
	async set(account, value) {
		// The key goes on standard input, not the command line, where other users could see it.
		const stored = await withInput(
			"secret-tool",
			["store", "--label", `hl: ${account}`, "service", KEYRING_SERVICE, "account", account],
			value,
		);
		return stored.mapError(
			(message) =>
				new SecretUnavailable({ kind: "keyring", message: `The Secret Service failed to store the key: ${message}` }),
		);
	},
	async delete(account) {
		try {
			await run("secret-tool", ["clear", "service", KEYRING_SERVICE, "account", account]);
			return Result.ok(undefined);
		} catch (cause: unknown) {
			return Result.err(
				new SecretUnavailable({ kind: "keyring", message: `The Secret Service failed: ${stderrOf(cause)}`, cause }),
			);
		}
	},
};

/** The macOS login Keychain, through `security`. */
const macKeychain: Keyring = {
	name: "Keychain",
	async get(account) {
		try {
			const { stdout } = await run("security", ["find-generic-password", "-s", KEYRING_SERVICE, "-a", account, "-w"]);
			return Result.ok(stdout.replace(/\n$/, ""));
		} catch (cause: unknown) {
			// 44: the item could not be found.
			if (exitCode(cause) === 44) {
				return Result.ok(undefined);
			}
			return Result.err(
				new SecretUnavailable({ kind: "keyring", message: `The Keychain failed: ${stderrOf(cause)}`, cause }),
			);
		}
	},
	async set(account, value) {
		// `security -i` reads the command from standard input, so the key isn't on a command line.
		const quote = (text: string) => `"${text.replace(/[\\"]/g, "\\$&")}"`;
		const line = `add-generic-password -U -s ${KEYRING_SERVICE} -a ${quote(account)} -l ${quote(`hl: ${account}`)} -w ${quote(value)}\n`;
		const stored = await withInput("security", ["-i"], line);
		return stored.mapError(
			(message) =>
				new SecretUnavailable({ kind: "keyring", message: `The Keychain failed to store the key: ${message}` }),
		);
	},
	async delete(account) {
		try {
			await run("security", ["delete-generic-password", "-s", KEYRING_SERVICE, "-a", account]);
			return Result.ok(undefined);
		} catch (cause: unknown) {
			if (exitCode(cause) === 44) {
				return Result.ok(undefined);
			}
			return Result.err(
				new SecretUnavailable({ kind: "keyring", message: `The Keychain failed: ${stderrOf(cause)}`, cause }),
			);
		}
	},
};

/** What resolving a secret needs. */
export interface SecretContext {
	readonly env: NodeJS.ProcessEnv;
	/** The keyring, loaded only when a key is in it. */
	keyring(): Promise<Result<Keyring, NoKeyring>>;
}

/** Returns the key `secret` refers to. */
export async function resolveSecret(
	secret: Secret,
	context: SecretContext,
): Promise<Result<string, SecretUnavailable>> {
	switch (secret.kind) {
		case "file":
			return Result.ok(secret.value);
		case "env": {
			const value = context.env[secret.name];
			return value === undefined || value === ""
				? Result.err(new SecretUnavailable({ kind: "env", message: `$${secret.name} is not set` }))
				: Result.ok(value);
		}
		case "command":
			return runCommand(secret.command);
		case "keyring": {
			const keyring = await context.keyring();
			if (keyring.isErr()) {
				return Result.err(
					new SecretUnavailable({
						kind: "keyring",
						message: `The key is in the keyring, but ${keyring.error.message}`,
					}),
				);
			}
			const value = await keyring.value.get(secret.account);
			if (value.isErr()) {
				return value;
			}
			return value.value === undefined || value.value === ""
				? Result.err(
						new SecretUnavailable({
							kind: "keyring",
							message: `The ${keyring.value.name} has no key for ${secret.account}`,
						}),
					)
				: Result.ok(value.value);
		}
		default:
			return casesHandled(secret);
	}
}

/** Returns how `secret` is kept, for listings, without the key. */
export function describeSecret(secret: Secret | undefined): string {
	switch (secret?.kind) {
		case undefined:
			return "none";
		case "keyring":
			return "keyring";
		case "command":
			return `command: ${secret.command}`;
		case "env":
			return `$${secret.name}`;
		case "file":
			return "config file";
		default:
			return casesHandled(secret);
	}
}

/** Runs a key command through the shell, and returns what it prints, without the last newline. */
async function runCommand(command: string): Promise<Result<string, SecretUnavailable>> {
	const [shell, flag] = process.platform === "win32" ? ["cmd.exe", "/c"] : ["/bin/sh", "-c"];
	try {
		const { stdout } = await run(shell, [flag, command], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
		const value = stdout.replace(/\r?\n$/, "");
		return value === ""
			? Result.err(new SecretUnavailable({ kind: "command", message: `\`${command}\` printed no key` }))
			: Result.ok(value);
	} catch (cause: unknown) {
		const detail = stderrOf(cause).split("\n")[0] ?? "";
		return Result.err(
			new SecretUnavailable({
				kind: "command",
				message: `\`${command}\` failed${detail === "" ? "" : `: ${detail}`}`,
				cause,
			}),
		);
	}
}

/** Runs `command` with `input` on standard input; fails with what it printed on standard error. */
function withInput(command: string, args: readonly string[], input: string): Promise<Result<void, string>> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
		child.on("error", (error) => resolve(Result.err(error.message)));
		child.on("close", (code) =>
			resolve(code === 0 ? Result.ok(undefined) : Result.err(stderr.trim() || `exit ${code ?? "?"}`)),
		);
		child.stdin.end(input);
	});
}

/** Whether `command` is on the PATH. */
async function found(command: string): Promise<boolean> {
	try {
		await run(process.platform === "win32" ? "where" : "which", [command]);
		return true;
	} catch {
		return false;
	}
}

function exitCode(cause: unknown): number | undefined {
	return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "number"
		? cause.code
		: undefined;
}

function stderrOf(cause: unknown): string {
	return typeof cause === "object" && cause !== null && "stderr" in cause && typeof cause.stderr === "string"
		? cause.stderr.trim()
		: "";
}

function casesHandled(unexpected: never): never {
	throw new Error(`unexpected case: ${JSON.stringify(unexpected)}`);
}
