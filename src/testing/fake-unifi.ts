/**
 * A fake UniFi console for tests: an HTTP server on localhost that answers
 * the integration API's routes the tests use, checks the API key, pages
 * lists, and records every request it gets.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A site of the fake console. */
export interface FakeSite {
	readonly id: string;
	readonly internalReference: string;
	readonly name: string;
}

/** A request the fake console got. */
export interface RecordedRequest {
	readonly method: string;
	/** The path and query, under the integration API's base path. */
	readonly path: string;
	readonly apiKey: string | undefined;
	readonly body: unknown;
}

/** The state of a fake console, which tests change between commands. */
export interface FakeUnifiState {
	version: string;
	readonly apiKey: string;
	readonly sites: FakeSite[];
	/** The devices of each site, by site id. */
	readonly devices: Map<string, Record<string, unknown>[]>;
}

/** A running fake console. */
export interface FakeUnifi {
	readonly url: string;
	readonly state: FakeUnifiState;
	readonly requests: RecordedRequest[];
	close(): Promise<void>;
}

const BASE = "/proxy/network/integration";

/** Starts a fake console with `state`, on a free port. */
export async function startFakeUnifi(state: FakeUnifiState): Promise<FakeUnifi> {
	const requests: RecordedRequest[] = [];
	const server = createServer((req, res) => {
		void handle(state, requests, req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo; // SAFETY: a TCP server listening on a port has an AddressInfo.
	return {
		url: `http://127.0.0.1:${port}`,
		state,
		requests,
		close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}

async function handle(state: FakeUnifiState, requests: RecordedRequest[], req: IncomingMessage, res: ServerResponse) {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	}
	const text = Buffer.concat(chunks).toString("utf8");
	const url = new URL(req.url ?? "/", "http://fake");
	const header = req.headers["x-api-key"];
	const apiKey = typeof header === "string" ? header : undefined;
	const method = req.method ?? "GET";
	let body: unknown;
	if (text !== "") {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	requests.push({ method, path: `${url.pathname.slice(BASE.length)}${url.search}`, apiKey, body });

	const send = (status: number, value: unknown) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(value));
	};
	const notFound = () =>
		send(404, { statusCode: 404, statusName: "NOT_FOUND", message: `No route ${method} ${url.pathname}` });

	if (!url.pathname.startsWith(`${BASE}/`)) {
		return notFound();
	}
	if (apiKey !== state.apiKey) {
		return send(401, { statusCode: 401, statusName: "UNAUTHORIZED", message: "Invalid API key" });
	}
	const parts = url.pathname.slice(BASE.length + 1).split("/");
	const page = (items: readonly unknown[]) => {
		const offset = Number(url.searchParams.get("offset") ?? "0");
		const limit = Number(url.searchParams.get("limit") ?? "25");
		const data = items.slice(offset, offset + limit);
		return { offset, limit, count: data.length, totalCount: items.length, data };
	};

	// /v1/info
	if (method === "GET" && parts.join("/") === "v1/info") {
		return send(200, { applicationVersion: state.version });
	}
	// /v1/sites
	if (method === "GET" && parts.join("/") === "v1/sites") {
		return send(200, page(state.sites));
	}
	const [v1, sites, siteId, resource, id] = parts;
	if (v1 !== "v1" || sites !== "sites" || siteId === undefined || !state.sites.some((site) => site.id === siteId)) {
		return notFound();
	}
	if (resource === "devices") {
		const devices = state.devices.get(siteId) ?? [];
		if (id === undefined && method === "GET") {
			return send(200, page(devices));
		}
		const index = devices.findIndex((device) => device["id"] === id);
		if (index === -1) {
			return notFound();
		}
		if (method === "GET") {
			return send(200, devices[index]);
		}
		if (method === "DELETE") {
			devices.splice(index, 1);
			return send(200, {});
		}
	}
	if (resource === "hotspot" && id === "vouchers" && method === "POST") {
		return send(201, { vouchers: [{ request: body }] });
	}
	return notFound();
}
