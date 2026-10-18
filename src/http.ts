/**
 * Sends requests to an instance, over undici, with the instance's TLS
 * settings. Failures are values: a status the server answered with, a
 * certificate it presented that can't be verified, or no answer at all.
 */
import { Result, TaggedError } from "better-result";
import { Agent, fetch } from "undici";

/** A request to send, with its URL already built. */
export interface HttpRequest {
	readonly method: string;
	readonly url: URL;
	readonly headers: Readonly<Record<string, string>>;
	/** A JSON body, serialized. */
	readonly body?: string | undefined;
}

/** A response with a 2XX status. */
export interface HttpResponse {
	readonly status: number;
	/** The body, parsed when it is JSON, else its text; undefined when it is empty. */
	readonly body: unknown;
}

/** The server answered with a status other than 2XX. */
export class HttpStatusError extends TaggedError("HttpStatusError")<{
	readonly method: string;
	readonly url: string;
	readonly status: number;
	readonly body: unknown;
	readonly message: string;
}> {}

/** The server's certificate could not be verified, as with a self-signed one. */
export class TlsUnverified extends TaggedError("TlsUnverified")<{
	readonly url: string;
	readonly code: string;
	readonly cause: unknown;
	readonly message: string;
}> {}

/** The server could not be reached, or did not answer in time. */
export class Unreachable extends TaggedError("Unreachable")<{
	readonly url: string;
	readonly cause: unknown;
	readonly message: string;
}> {}

/** What sending a request can fail with. */
export type HttpError = HttpStatusError | TlsUnverified | Unreachable;

/** Sends requests to one instance. */
export interface HttpClient {
	send(request: HttpRequest): Promise<Result<HttpResponse, HttpError>>;
}

/** The options of a client. */
export interface HttpClientOptions {
	/** Whether to accept a certificate that can't be verified. */
	readonly insecure: boolean;
	/** How long to wait for an answer, in milliseconds. */
	readonly timeoutMs: number;
}

const TLS_CODES = new Set([
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"CERT_HAS_EXPIRED",
	"ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Returns a client that sends requests with `options`. */
export function createHttpClient(options: HttpClientOptions): HttpClient {
	const dispatcher = new Agent({ connect: { rejectUnauthorized: !options.insecure } });
	return {
		async send(request) {
			const url = request.url.toString();
			let response: Awaited<ReturnType<typeof fetch>>;
			let text: string;
			try {
				response = await fetch(request.url, {
					method: request.method,
					headers: request.headers,
					body: request.body ?? null,
					dispatcher,
					signal: AbortSignal.timeout(options.timeoutMs),
				});
				text = await response.text();
			} catch (cause: unknown) {
				const code = errorCode(cause);
				if (code !== undefined && TLS_CODES.has(code)) {
					return Result.err(
						new TlsUnverified({
							url,
							code,
							cause,
							message: `The certificate of ${request.url.host} can't be verified (${code})`,
						}),
					);
				}
				return Result.err(
					new Unreachable({ url, cause, message: `Could not reach ${request.url.host}: ${describe(cause)}` }),
				);
			}
			const body = parseBody(text, response.headers.get("content-type"));
			if (!response.ok) {
				return Result.err(
					new HttpStatusError({
						method: request.method,
						url,
						status: response.status,
						body,
						message: `${request.method} ${request.url.pathname} failed with ${response.status}${statusDetail(body, response.statusText)}`,
					}),
				);
			}
			return Result.ok({ status: response.status, body });
		},
	};
}

function parseBody(text: string, contentType: string | null): unknown {
	if (text === "") {
		return undefined;
	}
	if (contentType !== null && /[/+]json\b/.test(contentType)) {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	return text;
}

/**
 * Returns what an error response says, as `: <message>`: its body's
 * `message`, or the reason in its status line (where Proxmox puts it), and
 * any per-field `errors`; or nothing.
 */
function statusDetail(body: unknown, statusText: string): string {
	const parts: string[] = [];
	if (typeof body === "string" && body.length > 0 && body.length < 300) {
		parts.push(body.trim());
	} else if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
		parts.push(body.message.trim());
	} else if (
		statusText !== "" &&
		!/^(Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error)$/i.test(statusText)
	) {
		parts.push(statusText);
	}
	if (
		typeof body === "object" &&
		body !== null &&
		"errors" in body &&
		typeof body.errors === "object" &&
		body.errors !== null
	) {
		parts.push(
			...Object.entries(body.errors).map(
				([field, error]) => `${field}: ${typeof error === "string" ? error.trim() : JSON.stringify(error)}`,
			),
		);
	}
	return parts.length === 0 ? "" : `: ${parts.join("; ")}`;
}

/** Returns the `code` of a fetch failure, which undici keeps on its cause. */
function errorCode(cause: unknown): string | undefined {
	for (let current: unknown = cause, depth = 0; current instanceof Error && depth < 4; depth++) {
		if ("code" in current && typeof current.code === "string") {
			return current.code;
		}
		current = current.cause;
	}
	return undefined;
}

function describe(cause: unknown): string {
	if (cause instanceof Error && cause.name === "TimeoutError") {
		return "timed out";
	}
	const code = errorCode(cause);
	if (code !== undefined) {
		return code;
	}
	return cause instanceof Error ? cause.message : "unknown error";
}
