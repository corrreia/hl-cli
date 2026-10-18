/**
 * The process entry: runs `hl` with the process's arguments, terminal and
 * environment.
 */
import { createInterface } from "node:readline/promises";
import { main } from "./cli.ts";
import { configPath, loadConfig } from "./config.ts";
import { systemKeyring } from "./secrets.ts";
import { SERVICES } from "./services/registry.ts";
import type { Io } from "./session.ts";

const io: Io = {
	stdout: { write: (text) => void process.stdout.write(text), isTTY: process.stdout.isTTY === true },
	stderr: { write: (text) => void process.stderr.write(text), isTTY: process.stderr.isTTY === true },
	async readStdin() {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
		}
		return Buffer.concat(chunks).toString("utf8");
	},
	async askSecret(question) {
		const { stdin, stderr } = process;
		if (stdin.isTTY !== true) {
			return undefined;
		}
		stderr.write(question);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		try {
			return await new Promise<string | undefined>((resolve) => {
				let typed = "";
				const onData = (chunk: string) => {
					for (const char of chunk) {
						if (char === "\r" || char === "\n" || char === "\u0004") {
							stdin.off("data", onData);
							stderr.write("\n");
							resolve(typed);
							return;
						}
						if (char === "\u0003") {
							stdin.off("data", onData);
							stderr.write("\n");
							resolve(undefined);
							return;
						}
						typed = char === "\u007f" || char === "\b" ? typed.slice(0, -1) : typed + char;
					}
				};
				stdin.on("data", onData);
			});
		} finally {
			stdin.setRawMode(false);
			stdin.pause();
		}
	},
	async confirm(question) {
		if (process.stdin.isTTY !== true) {
			return undefined;
		}
		const prompt = createInterface({ input: process.stdin, output: process.stderr });
		try {
			const answer = await prompt.question(`${question} [y/N] `);
			return /^y(es)?$/i.test(answer.trim());
		} finally {
			prompt.close();
		}
	},
};

const path = configPath(process.env);
const config = await loadConfig(path);
if (config.isErr()) {
	io.stderr.write(`✗ ${config.error.message}\n`);
	process.exitCode = 1;
} else {
	process.exitCode = await main(process.argv.slice(2), {
		io,
		env: process.env,
		now: () => new Date(),
		configPath: path,
		config: config.value,
		keyring: once(() => systemKeyring()),
		services: SERVICES,
		exitCode: 0,
	});
}

/** Returns a function that calls `f` the first time, and returns that promise every time. */
function once<T>(f: () => Promise<T>): () => Promise<T> {
	let promise: Promise<T> | undefined;
	return () => (promise ??= f());
}
