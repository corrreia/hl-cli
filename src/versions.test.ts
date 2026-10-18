import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Catalog, CommandSpec } from "./catalog.ts";
import type { ServiceDefinition } from "./service.ts";
import { startFakeUnifi, type FakeUnifi } from "./testing/fake-unifi.ts";
import { createTestHomelab, type TestHomelab } from "./testing/session.ts";

/** A command of the fake service's catalogues. */
function getCommand(path: readonly string[], route: string): CommandSpec {
	return {
		path,
		summary: `GET ${route}`,
		description: "",
		method: "GET",
		route,
		params: [],
		hidden: false,
		deprecated: false,
	};
}

const v1: Catalog = { version: "1.0.0", groups: [], commands: [getCommand(["sites", "list"], "/v1/sites")] };
const v2: Catalog = {
	version: "2.0.0",
	groups: [],
	commands: [getCommand(["sites", "list"], "/v1/sites"), getCommand(["sites", "export"], "/v1/info")],
};

/** A service with two versions, where 2.0.0 adds `sites export`. */
const fake: ServiceDefinition = {
	id: "fake",
	title: "Fake",
	basePath: "/proxy/network/integration",
	versions: { "1.0.0": () => Promise.resolve({ default: v1 }), "2.0.0": () => Promise.resolve({ default: v2 }) },
	authHeaders: (apiKey) => ({ "X-API-KEY": apiKey }),
	async probeVersion(api) {
		const info = await api.get("/v1/info");
		if (info.isErr()) {
			return info;
		}
		const version =
			typeof info.value === "object" && info.value !== null && "applicationVersion" in info.value
				? info.value.applicationVersion
				: undefined;
		return Result.ok(typeof version === "string" ? version : "0");
	},
	context: [],
};

let older: FakeUnifi;
let newer: FakeUnifi;
let lab: TestHomelab;

beforeEach(async () => {
	older = await startFakeUnifi({ version: "1.4.0", apiKey: "k", sites: [], devices: new Map() });
	newer = await startFakeUnifi({ version: "2.1.0", apiKey: "k", sites: [], devices: new Map() });
	lab = await createTestHomelab([fake]);
	await lab.run(["instances", "add", "fake", "newer", "--url", newer.url, "--api-key", "k"]);
	await lab.run(["instances", "add", "fake", "older", "--url", older.url, "--api-key", "k"]);
});

afterEach(async () => {
	await older.close();
	await newer.close();
});

describe("a service with several versions", () => {
	it("builds each instance's commands from the newest catalogue not newer than its server", async () => {
		const olderHelp = await lab.run(["fake@older", "sites", "--help"]);
		const newerHelp = await lab.run(["fake@newer", "sites", "--help"]);

		expect(olderHelp.stdout).not.toContain("hl fake sites export");
		expect(newerHelp.stdout).toContain("hl fake sites export");
		expect(await lab.run(["fake@older", "--help"])).toMatchObject({
			stdout: expect.stringContaining("Commands for fake@older, from Fake 1.0.0 (older runs a different version)."),
		});
	});

	it("runs --all on each instance with its own commands, skipping those without the command", async () => {
		const exported = await lab.run(["fake", "sites", "export", "--all"]);

		expect(exported.code).toBe(0);
		expect(exported.stderr).toContain("⚠ skipped fake@older: Fake 1.0.0 has no `sites export`");
		expect(JSON.parse(exported.stdout)).toEqual({ newer: { applicationVersion: "2.1.0" } });
	});
});
