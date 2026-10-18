/**
 * TrueNAS (25.10 and later), with an API key (Settings → API Keys), over
 * its JSON-RPC 2.0 WebSocket API. Each command is called on the API version
 * its catalogue is from (`/api/v25.10.0`), which every later release still
 * serves, so a command means exactly what it meant in that version.
 */
import { Result } from "better-result";
import { openRpc, RpcFailed, waitForJob, type RpcConnection } from "../../jsonrpc.ts";
import type { Connection } from "../../service.ts";
import { defineService } from "../define.ts";
import versions from "./_generated/versions.ts";

/** How long to wait for the server, and how often to check a job. */
const TIMEOUT_MS = 30_000;
const JOB_INTERVAL_MS = 1_000;

/** Opens the API at `path` (`current`, or `v25.10.0`) and logs in with the key. */
async function session(connection: Connection, path: string): Promise<Result<RpcConnection, { message: string }>> {
	const url = new URL(`/api/${path}`, connection.url);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const opened = await openRpc(url, { insecure: connection.insecure, timeoutMs: TIMEOUT_MS });
	if (opened.isErr()) {
		return opened;
	}
	const rpc = opened.value;
	if (connection.apiKey === undefined) {
		rpc.close();
		return Result.err(
			new RpcFailed({ method: "auth.login_with_api_key", code: undefined, message: "TrueNAS needs an API key" }),
		);
	}
	const login = await rpc.call("auth.login_with_api_key", [connection.apiKey]);
	if (login.isErr() || login.value !== true) {
		rpc.close();
		return Result.err(
			new RpcFailed({
				method: "auth.login_with_api_key",
				code: undefined,
				message: login.isErr() ? login.error.message : "TrueNAS rejected the API key",
			}),
		);
	}
	return Result.ok(rpc);
}

/** TrueNAS. */
export const service = defineService({
	id: "truenas",
	title: "TrueNAS",
	basePath: "",
	versions,
	// The key logs in over the WebSocket; it isn't a header.
	auth: () => ({}),
	async probe(api) {
		const rpc = await session(api.connection, "current");
		if (rpc.isErr()) {
			return Result.err(new RpcFailed({ method: "system.version_short", code: undefined, message: rpc.error.message }));
		}
		const version = await rpc.value.call("system.version_short", []);
		rpc.value.close();
		if (version.isErr()) {
			return version;
		}
		return typeof version.value === "string"
			? Result.ok(version.value)
			: Result.err(
					new RpcFailed({ method: "system.version_short", code: undefined, message: "TrueNAS sent no version" }),
				);
	},
	async call(api, command, body, version) {
		const { rpc: method } = command;
		if (method === undefined) {
			return Result.err({ message: `${command.path.join(" ")} isn't a TrueNAS method` });
		}
		const rpc = await session(api.connection, `v${version}`);
		if (rpc.isErr()) {
			return rpc;
		}
		try {
			// Positional parameters, in order: trailing ones not given are left out, for
			// the server's defaults; a gap before one that is given takes its default.
			const fields =
				typeof body === "object" && body !== null ? new Map(Object.entries(body)) : new Map<string, unknown>();
			const given = method.params.map((name) => fields.get(name));
			while (given.length > 0 && given.at(-1) === undefined) {
				given.pop();
			}
			const params = given.map((value, i) => value ?? method.defaults?.[method.params[i] ?? ""] ?? null);
			const result = await rpc.value.call(method.method, params);
			if (result.isErr() || !method.job) {
				return result;
			}
			// A job's call returns its id; its result comes when it's done.
			if (typeof result.value !== "number") {
				return Result.err(
					new RpcFailed({ method: method.method, code: undefined, message: `${method.method} started no job` }),
				);
			}
			return await waitForJob(rpc.value, result.value, { intervalMs: JOB_INTERVAL_MS });
		} finally {
			rpc.value.close();
		}
	},
});
