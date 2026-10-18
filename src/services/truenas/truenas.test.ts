import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { WebSocketServer } from "ws";
import { createTestHomelab, type TestHomelab } from "../../testing/session.ts";
import { service } from "./service.ts";

interface Call {
	readonly path: string;
	readonly method: string;
	readonly params: unknown;
}

/**
 * A fake TrueNAS JSON-RPC API over WebSocket, at `/api/current` and
 * `/api/v<version>` for each of `apis`, recording calls; other paths are 404.
 */
async function fakeTruenas(
	version: string,
	apis: readonly string[] = ["25.10.0", "27.0.0", "28.0.0"],
): Promise<{ url: string; calls: Call[]; server: Server }> {
	const calls: Call[] = [];
	const server = createServer();
	const served = new Set(["/api/current", ...apis.map((api) => `/api/v${api}`)]);
	const wss = new WebSocketServer({
		server,
		verifyClient: ({ req }, done) => done(served.has(req.url ?? ""), 404),
	});
	wss.on("connection", (socket, request) => {
		const path = request.url ?? "";
		let loggedIn = false;
		let polls = 0;
		socket.on("message", (data: Buffer) => {
			const { id, method, params } = JSON.parse(data.toString()) as { id: number; method: string; params: unknown[] }; // SAFETY: the test's own client sends these.
			calls.push({ path, method, params });
			const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
			const fail = (reason: string) =>
				socket.send(
					JSON.stringify({
						jsonrpc: "2.0",
						id,
						error: { code: -32001, message: "Method call error", data: { reason } },
					}),
				);
			if (method === "auth.login_with_api_key") {
				loggedIn = params[0] === "1-secret";
				return reply(loggedIn);
			}
			if (!loggedIn) {
				return fail("Not authenticated");
			}
			switch (method) {
				case "system.version_short":
					return reply(version);
				case "pool.query":
					return reply([{ id: 1, name: "tank", status: "ONLINE", healthy: true }]);
				case "pool.scrub.run":
					return fail(`[ENOENT] Pool ${String(params[0])} not found`);
				case "system.reboot":
					return reply(42);
				case "core.get_jobs":
					polls++;
					return reply([
						polls < 2
							? { id: 42, state: "RUNNING", progress: { percent: 50 } }
							: { id: 42, state: "SUCCESS", result: null },
					]);
				default:
					return fail(`No such method ${method}`);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo; // SAFETY: a TCP server listening on a port has an AddressInfo.
	return { url: `http://127.0.0.1:${port}`, calls, server };
}

let nas: Awaited<ReturnType<typeof fakeTruenas>>;
let lab: TestHomelab;

async function setUp(version: string) {
	nas = await fakeTruenas(version);
	lab = await createTestHomelab([service]);
	return lab.run(["instances", "add", "truenas", "nas", "--url", nas.url], { secret: "1-secret" });
}

afterEach(async () => {
	await new Promise<void>((resolve) => nas.server.close(() => resolve()));
});

describe("truenas", () => {
	beforeEach(async () => {
		const added = await setUp("28.0.1");
		expect(added.stderr).toContain("truenas@nas: TrueNAS 28.0.1 (commands from 28.0.0)");
	});

	it("calls a method on the API version its commands are from, with positional parameters", async () => {
		const listed = await lab.run([
			"truenas",
			"pool",
			"query",
			"--filters",
			'["name","=","tank"]',
			"-o",
			"table",
			"--columns",
			"name,status",
		]);

		expect(listed.stdout).toBe(["NAME  STATUS", "tank  ONLINE", ""].join("\n"));
		expect(nas.calls.slice(-2)).toEqual([
			{ path: "/api/v28.0.0", method: "auth.login_with_api_key", params: ["1-secret"] },
			{ path: "/api/v28.0.0", method: "pool.query", params: [[["name", "=", "tank"]]] },
		]);
	});

	it("fills a gap before a given parameter with its default", async () => {
		await lab.run(["truenas", "pool", "query", "--options", '{"limit":1}']);

		expect(nas.calls.at(-1)?.params).toEqual([[], { limit: 1 }]);
	});

	it("waits for a job and prints its result", async () => {
		const rebooted = await lab.run(["truenas", "system", "reboot", "run", "--reason", "test", "--yes"]);

		expect(rebooted.code).toBe(0);
		expect(nas.calls.filter((call) => call.method === "core.get_jobs")).toHaveLength(2);
	});

	it("shows TrueNAS's reason when a call fails", async () => {
		const scrubbed = await lab.run(["truenas", "pool", "scrub", "run", "--name", "nope"]);

		expect(scrubbed.code).toBe(1);
		expect(scrubbed.stderr).toContain("pool.scrub.run: [ENOENT] Pool nope not found");
	});
});

describe("truenas versions", () => {
	it("calls a 25.10.x server on the v25.10.0 API", async () => {
		await setUp("25.10.3");

		await lab.run(["truenas", "pool", "query"]);

		expect(nas.calls.at(-1)).toEqual({ path: "/api/v25.10.0", method: "pool.query", params: [] });
	});

	it("calls a server older than every command set on its current API", async () => {
		nas = await fakeTruenas("25.04.2.6", ["25.04.0", "25.04.1", "25.04.2"]);
		lab = await createTestHomelab([service]);
		await lab.run(["instances", "add", "truenas", "nas", "--url", nas.url], { secret: "1-secret" });

		const listed = await lab.run(["truenas", "pool", "query"]);

		expect(listed.code).toBe(0);
		expect(listed.stderr).toContain("older than any TrueNAS version hl has (oldest: 25.10.0)");
		expect(nas.calls.at(-1)).toEqual({ path: "/api/current", method: "pool.query", params: [] });
	});

	it("doesn't save an instance whose key TrueNAS rejects", async () => {
		nas = await fakeTruenas("28.0.1");
		lab = await createTestHomelab([service]);

		const added = await lab.run(["instances", "add", "truenas", "nas", "--url", nas.url], { secret: "wrong" });

		expect(added.code).toBe(1);
		expect(added.stderr).toContain("TrueNAS rejected the API key");
	});
});
