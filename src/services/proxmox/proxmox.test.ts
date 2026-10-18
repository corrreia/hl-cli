import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createTestHomelab, type TestHomelab } from "../../testing/session.ts";
import { service } from "./service.ts";

interface Seen {
	readonly method: string;
	readonly path: string;
	readonly authorization: string | undefined;
	readonly body: string;
}

/** A fake Proxmox VE API with the nodes given, recording requests. */
async function fakeProxmox(nodes: readonly string[]): Promise<{ url: string; seen: Seen[]; server: Server }> {
	const seen: Seen[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => (body += chunk.toString()));
		req.on("end", () => {
			const path = req.url ?? "";
			seen.push({ method: req.method ?? "", path, authorization: req.headers.authorization, body });
			const send = (status: number, value: unknown, reason?: string) => {
				res.writeHead(status, reason ?? "", { "content-type": "application/json;charset=UTF-8" });
				res.end(JSON.stringify(value));
			};
			if (path === "/api2/json/version") {
				return send(200, { data: { version: "9.2.4", release: "9.2" } });
			}
			if (path === "/api2/json/nodes") {
				return send(200, { data: nodes.map((node) => ({ node, status: "online" })) });
			}
			if (path === "/api2/json/nodes/pve/qemu") {
				return send(200, {
					data: [
						{ vmid: 100, name: "web", status: "running" },
						{ vmid: 101, name: "db", status: "stopped" },
					],
				});
			}
			if (req.method === "POST" && path === "/api2/json/nodes/pve/qemu/101/status/start") {
				return send(200, { data: "UPID:pve:00001:qmstart:101:root@pam!hl:" });
			}
			if (req.method === "POST" && path === "/api2/json/nodes/pve/qemu/999/status/start") {
				return send(500, { data: null }, "Configuration file 'nodes/pve/qemu-server/999.conf' does not exist");
			}
			return send(501, { data: null }, `Method '${req.method} ${path}' not implemented`);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo; // SAFETY: a TCP server listening on a port has an AddressInfo.
	return { url: `http://127.0.0.1:${port}`, seen, server };
}

let pve: Awaited<ReturnType<typeof fakeProxmox>>;
let lab: TestHomelab;

async function setUp(nodes: readonly string[]) {
	pve = await fakeProxmox(nodes);
	lab = await createTestHomelab([service]);
	const added = await lab.run([
		"instances",
		"add",
		"proxmox",
		"lab",
		"--url",
		pve.url,
		"--api-key",
		"root@pam!hl=secret",
	]);
	expect(added.stderr).toContain("proxmox@lab: Proxmox VE 9.2.4 (commands from 9.2)");
}

afterEach(async () => {
	await new Promise<void>((resolve) => pve.server.close(() => resolve()));
});

describe("proxmox", () => {
	beforeEach(async () => {
		await setUp(["pve"]);
	});

	it("uses the only node, sends the API token, and prints what's in data", async () => {
		const listed = await lab.run(["proxmox", "qemu", "list", "-o", "table", "--columns", "vmid,name,status"]);

		expect(listed.stdout).toBe(["VMID  NAME  STATUS", "100   web   running", "101   db    stopped", ""].join("\n"));
		expect(pve.seen.at(-1)).toMatchObject({
			path: "/api2/json/nodes/pve/qemu",
			authorization: "PVEAPIToken=root@pam!hl=secret",
		});
	});

	it("starts a VM, with the VM id as an argument", async () => {
		const started = await lab.run(["proxmox", "qemu", "status", "start", "101"]);

		expect(started.code).toBe(0);
		expect(started.stdout).toBe("UPID:pve:00001:qmstart:101:root@pam!hl:\n");
	});

	it("shows the reason Proxmox puts in the status line", async () => {
		const started = await lab.run(["proxmox", "qemu", "status", "start", "999"]);

		expect(started.code).toBe(1);
		expect(started.stderr).toContain(
			"failed with 500: Configuration file 'nodes/pve/qemu-server/999.conf' does not exist",
		);
	});
});

describe("proxmox clusters", () => {
	beforeEach(async () => {
		await setUp(["pve", "pve2"]);
	});

	it("asks for --node when the cluster has several", async () => {
		const listed = await lab.run(["proxmox", "qemu", "list"]);

		expect(listed.code).toBe(1);
		expect(listed.stderr).toContain("The cluster has 2 nodes; pass --node with one of: pve, pve2");
	});

	it("uses --node", async () => {
		const listed = await lab.run(["proxmox", "qemu", "list", "--node", "pve"]);

		expect(listed.code).toBe(0);
		expect(pve.seen.at(-1)?.path).toBe("/api2/json/nodes/pve/qemu");
	});
});
