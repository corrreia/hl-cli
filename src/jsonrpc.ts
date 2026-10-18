/**
 * JSON-RPC 2.0 over WebSocket, as TrueNAS's API speaks it: connect, call
 * methods with positional parameters, and wait for jobs.
 */
import { Result, TaggedError } from "better-result";
import { Agent, WebSocket } from "undici";
import { z } from "zod";
import { TlsUnverified, Unreachable } from "./http.ts";

/** A call failed: the server answered with an error, or the connection broke. */
export class RpcFailed extends TaggedError("RpcFailed")<{
	readonly method: string;
	readonly code: number | undefined;
	readonly message: string;
}> {}

/** What calling over JSON-RPC can fail with. */
export type RpcError = RpcFailed | Unreachable | TlsUnverified;

/** An open connection. */
export interface RpcConnection {
	call(method: string, params: readonly unknown[]): Promise<Result<unknown, RpcFailed>>;
	close(): void;
}

/** The options of {@link openRpc}. */
export interface RpcOptions {
	readonly insecure: boolean;
	readonly timeoutMs: number;
}

const ResponseSchema = z.looseObject({
	id: z.union([z.number(), z.string()]).optional(),
	result: z.unknown().optional(),
	error: z
		.looseObject({
			code: z.number().optional(),
			message: z.string().optional(),
			data: z.looseObject({ reason: z.string().optional(), errname: z.string().optional() }).nullish(),
		})
		.optional(),
});

/** Opens a connection to `url` (`ws:` or `wss:`). */
export function openRpc(url: URL, options: RpcOptions): Promise<Result<RpcConnection, Unreachable | TlsUnverified>> {
	return new Promise((resolve) => {
		const socket = new WebSocket(url, {
			dispatcher: new Agent({ connect: { rejectUnauthorized: !options.insecure } }),
		});
		const pending = new Map<number, (response: z.infer<typeof ResponseSchema>) => void>();
		let nextId = 1;
		let opened = false;
		const timer = setTimeout(() => {
			socket.close();
			resolve(
				Result.err(
					new Unreachable({ url: url.toString(), cause: undefined, message: `Could not reach ${url.host}: timed out` }),
				),
			);
		}, options.timeoutMs);

		socket.addEventListener("open", () => {
			opened = true;
			clearTimeout(timer);
			resolve(
				Result.ok({
					call(method, params) {
						return new Promise((settle) => {
							if (socket.readyState !== WebSocket.OPEN) {
								settle(Result.err(new RpcFailed({ method, code: undefined, message: "The connection is closed" })));
								return;
							}
							const id = nextId++;
							const timeout = setTimeout(() => {
								pending.delete(id);
								settle(Result.err(new RpcFailed({ method, code: undefined, message: `${method} timed out` })));
							}, options.timeoutMs);
							pending.set(id, (response) => {
								clearTimeout(timeout);
								if (response.error !== undefined) {
									const reason = response.error.data?.reason ?? response.error.message ?? "failed";
									settle(
										Result.err(
											new RpcFailed({ method, code: response.error.code, message: `${method}: ${reason.trim()}` }),
										),
									);
								} else {
									settle(Result.ok(response.result));
								}
							});
							socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
						});
					},
					close() {
						socket.close();
					},
				}),
			);
		});
		socket.addEventListener("message", (event) => {
			let parsed: z.infer<typeof ResponseSchema>;
			try {
				parsed = ResponseSchema.parse(JSON.parse(String(event.data)));
			} catch {
				return;
			}
			// Notifications have no id; only answers to calls matter here.
			const settle = typeof parsed.id === "number" ? pending.get(parsed.id) : undefined;
			if (settle !== undefined && typeof parsed.id === "number") {
				pending.delete(parsed.id);
				settle(parsed);
			}
		});
		socket.addEventListener("error", (event) => {
			if (opened) {
				return;
			}
			clearTimeout(timer);
			const cause: unknown = "error" in event ? event.error : undefined;
			const text =
				cause instanceof Error ? `${cause.message} ${cause.cause instanceof Error ? cause.cause.message : ""}` : "";
			const tls = /certificate|self[- ]signed|UNABLE_TO_VERIFY|CERT_/i.test(text);
			resolve(
				Result.err(
					tls
						? new TlsUnverified({
								url: url.toString(),
								code: "CERT",
								cause,
								message: `The certificate of ${url.host} can't be verified`,
							})
						: new Unreachable({
								url: url.toString(),
								cause,
								// A refused connection and a refused handshake (such as a 404 for an
								// API version the server doesn't serve) fail alike, so name the path.
								message: `Could not open ${url.toString()}${text.trim() === "" ? "" : `: ${text.trim()}`}`,
							}),
				),
			);
		});
		socket.addEventListener("close", () => {
			for (const [id, settle] of pending) {
				pending.delete(id);
				settle({ id, error: { message: "The connection closed" } });
			}
		});
	});
}

const JobSchema = z.looseObject({
	state: z.string(),
	result: z.unknown().optional(),
	error: z.string().nullish(),
	progress: z.looseObject({ percent: z.number().nullish(), description: z.string().nullish() }).nullish(),
});

/** The options of {@link waitForJob}. */
export interface WaitOptions {
	/** How long to wait between checks, in milliseconds. */
	readonly intervalMs: number;
	/** Called with the job's progress, when it says. */
	readonly onProgress?: (percent: number | undefined, description: string | undefined) => void;
}

/** Waits for the job `id` to finish, and returns its result. */
export async function waitForJob(
	connection: RpcConnection,
	id: number,
	options: WaitOptions,
): Promise<Result<unknown, RpcFailed>> {
	for (;;) {
		const jobs = await connection.call("core.get_jobs", [[["id", "=", id]]]);
		if (jobs.isErr()) {
			return jobs;
		}
		const job = z.array(JobSchema).safeParse(jobs.value);
		const [found] = job.success ? job.data : [];
		if (found === undefined) {
			return Result.err(new RpcFailed({ method: "core.get_jobs", code: undefined, message: `Job ${id} is gone` }));
		}
		if (found.state === "SUCCESS") {
			return Result.ok(found.result);
		}
		if (found.state === "FAILED" || found.state === "ABORTED") {
			return Result.err(
				new RpcFailed({
					method: "core.get_jobs",
					code: undefined,
					message: `Job ${id} ${found.state.toLowerCase()}: ${found.error ?? "no reason given"}`,
				}),
			);
		}
		options.onProgress?.(found.progress?.percent ?? undefined, found.progress?.description ?? undefined);
		await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
	}
}
