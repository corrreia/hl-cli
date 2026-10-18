import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { startFakeUnifi, type FakeUnifi } from "../../testing/fake-unifi.ts";
import { createTestHomelab, type TestHomelab } from "../../testing/session.ts";
import { unifi } from "./service.ts";

const HOME_SITE = { id: "11111111-1111-4111-8111-111111111111", internalReference: "default", name: "Default" };
const GUEST_SITE = { id: "22222222-2222-4222-8222-222222222222", internalReference: "guest", name: "Guest House" };

function device(id: string, name: string) {
	return {
		id,
		name,
		model: "U7PRO",
		state: "ONLINE",
		macAddress: `aa:bb:cc:00:00:${id.slice(-2)}`,
		features: ["accessPoint"],
	};
}

let home: FakeUnifi;
let cabin: FakeUnifi;
let lab: TestHomelab;

beforeEach(async () => {
	home = await startFakeUnifi({
		version: "10.6.106",
		apiKey: "home-key",
		sites: [HOME_SITE],
		devices: new Map([[HOME_SITE.id, [device("d-01", "Living room AP"), device("d-02", "Office AP")]]]),
	});
	cabin = await startFakeUnifi({
		version: "10.6.106",
		apiKey: "cabin-key",
		sites: [HOME_SITE, GUEST_SITE],
		devices: new Map([
			[HOME_SITE.id, [device("c-01", "Cabin AP")]],
			[GUEST_SITE.id, [device("g-01", "Guest AP")]],
		]),
	});
	lab = await createTestHomelab([unifi], { env: { CABIN_KEY: "cabin-key" } });
});

afterEach(async () => {
	await home.close();
	await cabin.close();
});

async function addBoth() {
	expect((await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"])).code).toBe(
		0,
	);
	expect(
		(await lab.run(["instances", "add", "unifi", "cabin", "--url", cabin.url, "--api-key-env", "CABIN_KEY"])).code,
	).toBe(0);
}

/** The requests a console got, past the version and site lookups. */
function apiCalls(console: FakeUnifi) {
	return console.requests.filter((r) => r.path !== "/v1/info" && !r.path.startsWith("/v1/sites?"));
}

describe("instances", () => {
	it("adds an instance, asking it for its version, and makes the first one the default", async () => {
		const added = await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);

		expect(added.code).toBe(0);
		expect(added.stderr).toContain("unifi@home: UniFi Network 10.6.106 — default; key: keyring");
		expect(await lab.readConfig()).toEqual({
			instances: {
				unifi: {
					home: {
						url: home.url,
						secret: { kind: "keyring", account: "unifi/home" },
						insecure: false,
						context: {},
						detected: { version: "10.6.106", at: "2026-10-18T12:00:00.000Z" },
					},
				},
			},
			defaults: { unifi: "home" },
		});
		expect(lab.keyring?.keys.get("unifi/home")).toBe("home-key");
	});

	it("doesn't save an instance whose key the server rejects", async () => {
		const added = await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "wrong"]);

		expect(added.code).toBe(1);
		expect(added.stderr).toContain("failed with 401: Invalid API key");
		expect((await lab.run(["instances", "list"])).stderr).toContain("No instances yet");
	});

	it("lists instances with their versions and the default", async () => {
		await addBoth();

		const listed = await lab.run(["instances", "list"]);

		expect(listed.stdout).toMatch(/SERVICE\s+NAME\s+DEFAULT\s+URL\s+VERSION/);
		expect(listed.stdout).toMatch(/unifi\s+cabin\s+http/);
		expect(listed.stdout).toMatch(/unifi\s+home\s+\*\s+http/);
		expect(listed.stdout).toMatch(/\bkeyring\b/);
		expect(listed.stdout + listed.stderr).not.toContain("home-key");
	});
});

describe("picking an instance", () => {
	it("uses the default instance, and the only site when there is one", async () => {
		await addBoth();

		const listed = await lab.run(["unifi", "devices", "list"]);

		expect(listed.code).toBe(0);
		expect(JSON.parse(listed.stdout)).toMatchObject({ totalCount: 2, data: [{ id: "d-01" }, { id: "d-02" }] });
		expect(apiCalls(home).map((r) => r.path)).toEqual([`/v1/sites/${HOME_SITE.id}/devices`]);
		expect(apiCalls(cabin)).toEqual([]);
	});

	it("uses the instance named with service@instance, with its own key", async () => {
		await addBoth();

		const got = await lab.run(["unifi@cabin", "devices", "get", "g-01", "--site", "Guest House"]);

		expect(got.code).toBe(0);
		expect(JSON.parse(got.stdout)).toMatchObject({ id: "g-01", name: "Guest AP" });
		expect(apiCalls(cabin)).toEqual([
			{ method: "GET", path: `/v1/sites/${GUEST_SITE.id}/devices/g-01`, apiKey: "cabin-key", body: undefined },
		]);
		expect(apiCalls(home)).toEqual([]);
	});

	it("asks for --site when the console has several sites", async () => {
		await addBoth();

		const listed = await lab.run(["unifi@cabin", "devices", "list"]);

		expect(listed.code).toBe(1);
		expect(listed.stderr).toContain(
			"The console has 2 sites; pass --site with one of: Default (default), Guest House (guest)",
		);
	});

	it("uses an instance's default site", async () => {
		await lab.run([
			"instances",
			"add",
			"unifi",
			"cabin",
			"--url",
			cabin.url,
			"--api-key",
			"cabin-key",
			"--site",
			"guest",
		]);

		const listed = await lab.run(["unifi", "devices", "list"]);

		expect(JSON.parse(listed.stdout)).toMatchObject({ data: [{ id: "g-01" }] });
	});

	it("switches the default with instances use", async () => {
		await addBoth();
		await lab.run(["instances", "use", "unifi", "cabin"]);

		const listed = await lab.run(["unifi", "devices", "list", "--site", "default"]);

		expect(JSON.parse(listed.stdout)).toMatchObject({ data: [{ id: "c-01" }] });
	});

	it("says how to pick when there are several instances and no default", async () => {
		await addBoth();
		await lab.run(["instances", "add", "unifi", "spare", "--url", cabin.url, "--api-key", "cabin-key"]);
		// Removing the default leaves cabin and spare, and no default.
		await lab.run(["instances", "remove", "unifi", "home"]);

		const listed = await lab.run(["unifi", "sites", "list"]);

		expect(listed.code).toBe(1);
		expect(listed.stderr).toContain("UniFi Network has 2 instances (cabin, spare); pick one with unifi@<name>");
	});
});

describe("--all", () => {
	it("prints one table with an INSTANCE column", async () => {
		await addBoth();

		const listed = await lab.run([
			"unifi",
			"devices",
			"list",
			"--all",
			"--site",
			"default",
			"-o",
			"table",
			"--columns",
			"name,state",
		]);

		expect(listed.stdout).toBe(
			[
				"INSTANCE  NAME            STATE",
				"cabin     Cabin AP        ONLINE",
				"home      Living room AP  ONLINE",
				"home      Office AP       ONLINE",
				"",
			].join("\n"),
		);
	});

	it("reports an instance that fails, and still prints the others", async () => {
		await addBoth();

		const listed = await lab.run(["unifi", "devices", "list", "--all"]);

		expect(listed.code).toBe(1);
		expect(listed.stderr).toContain("✗ unifi@cabin: The console has 2 sites");
		expect(JSON.parse(listed.stdout)).toMatchObject({ home: { totalCount: 2 } });
	});
});

describe("requests", () => {
	beforeEach(async () => {
		await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);
	});

	it("fetches every page with --all-pages", async () => {
		const devices = Array.from({ length: 450 }, (_, i) => device(`p-${String(i).padStart(3, "0")}`, `AP ${i}`));
		home.state.devices.set(HOME_SITE.id, devices);

		const listed = await lab.run(["unifi", "devices", "list", "--all-pages"]);

		const items: unknown = JSON.parse(listed.stdout);
		expect(Array.isArray(items) && items.length).toBe(450);
		expect(apiCalls(home).map((r) => r.path)).toEqual([
			`/v1/sites/${HOME_SITE.id}/devices?offset=0&limit=200`,
			`/v1/sites/${HOME_SITE.id}/devices?offset=200&limit=200`,
			`/v1/sites/${HOME_SITE.id}/devices?offset=400&limit=200`,
		]);
	});

	it("sends query flags", async () => {
		await lab.run(["unifi", "devices", "list", "--limit", "1", "--filter", "name.like('Office*')"]);

		expect(apiCalls(home).map((r) => r.path)).toEqual([
			`/v1/sites/${HOME_SITE.id}/devices?limit=1&filter=name.like%28%27Office*%27%29`,
		]);
	});

	it("merges body field flags over --body", async () => {
		const created = await lab.run([
			"unifi",
			"vouchers",
			"create",
			"--body",
			'{"name":"Guests","count":1,"timeLimitMinutes":60}',
			"--count",
			"5",
		]);

		expect(created.code).toBe(0);
		expect(apiCalls(home)).toMatchObject([
			{ method: "POST", body: { name: "Guests", count: 5, timeLimitMinutes: 60 } },
		]);
	});

	it("reads --body from standard input", async () => {
		await lab.run(["unifi", "vouchers", "create", "--body", "@-"], { stdin: '{"name":"Piped","timeLimitMinutes":30}' });

		expect(apiCalls(home)).toMatchObject([{ method: "POST", body: { name: "Piped", timeLimitMinutes: 30 } }]);
	});

	it("prints the request without sending it with --dry-run", async () => {
		const dry = await lab.run([
			"unifi",
			"vouchers",
			"create",
			"--name",
			"Guests",
			"--time-limit-minutes",
			"60",
			"--dry-run",
		]);

		expect(JSON.parse(dry.stdout)).toEqual({
			instance: "unifi@home",
			method: "POST",
			url: `${home.url}/proxy/network/integration/v1/sites/${HOME_SITE.id}/hotspot/vouchers`,
			body: { name: "Guests", timeLimitMinutes: 60 },
		});
		expect(apiCalls(home)).toEqual([]);
	});

	it("rejects a flag value of the wrong type before sending", async () => {
		const created = await lab.run(["unifi", "vouchers", "create", "--name", "Guests", "--count", "1.5"]);

		expect(created.code).toBe(1);
		expect(created.stderr).toContain("--count must be an integer");
		expect(apiCalls(home)).toEqual([]);
	});

	it("requires required query flags before sending", async () => {
		const ordering = await lab.run(["unifi", "firewall", "policies", "ordering"]);

		expect(ordering.code).toBe(1);
		expect(ordering.stderr).toContain(
			"Missing required arguments: source-firewall-zone-id, destination-firewall-zone-id",
		);
		expect(apiCalls(home)).toEqual([]);
	});

	it("shows the server's message when a request fails", async () => {
		const got = await lab.run(["unifi", "devices", "get", "missing"]);

		expect(got.code).toBe(1);
		expect(got.stderr).toContain("failed with 404: No route GET");
	});
});

describe("destructive commands", () => {
	beforeEach(async () => {
		await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);
	});

	it("needs --yes without a terminal to confirm on", async () => {
		const removed = await lab.run(["unifi", "devices", "remove", "d-01"]);

		expect(removed.code).toBe(1);
		expect(removed.stderr).toContain("pass --yes");
		expect(apiCalls(home)).toEqual([]);
	});

	it("asks first, naming the instance, and stops on no", async () => {
		const removed = await lab.run(["unifi", "devices", "remove", "d-01"], { confirm: false });

		expect(removed.code).toBe(1);
		expect(removed.asked).toEqual([
			"This removes (forgets) the device from the site.\nRun `devices remove` on unifi@home?",
		]);
		expect(apiCalls(home)).toEqual([]);
	});

	it("sends the request with --yes", async () => {
		const removed = await lab.run(["unifi", "devices", "remove", "d-01", "--yes"]);

		expect(removed.code).toBe(0);
		expect(apiCalls(home)).toMatchObject([{ method: "DELETE", path: `/v1/sites/${HOME_SITE.id}/devices/d-01` }]);
	});
});

describe("versions", () => {
	it("asks the server again once the saved version is a day old, and saves the new one", async () => {
		await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);
		home.state.version = "10.7.2";

		await lab.run(["unifi", "sites", "list"]);
		expect(await lab.readConfig()).toMatchObject({
			instances: { unifi: { home: { detected: { version: "10.6.106" } } } },
		});

		lab.now = new Date("2026-10-19T12:00:01Z");
		await lab.run(["unifi", "sites", "list"]);
		expect(await lab.readConfig()).toMatchObject({
			instances: { unifi: { home: { detected: { version: "10.7.2", at: "2026-10-19T12:00:01.000Z" } } } },
		});
	});

	it("warns when a server is older than every bundled version", async () => {
		home.state.version = "8.0.0";
		const added = await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);
		expect(added.stderr).toContain("UniFi Network 8.0.0 (commands from 9.1.120)");

		const listed = await lab.run(["unifi", "sites", "list"]);

		expect(listed.stderr).toContain("runs 8.0.0, older than any UniFi Network version hl has (oldest: 9.1.120)");
	});

	it("gives a 9.x console the 9.x commands", async () => {
		home.state.version = "9.4.19";
		await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);

		const help = await lab.run(["unifi", "--help"]);
		const wifi = await lab.run(["unifi", "wifi", "list"]);
		const devices = await lab.run(["unifi", "devices", "list"]);

		expect(help.stdout).toContain("Commands for unifi@home, from UniFi Network 9.4.19.");
		expect(help.stdout).not.toContain("hl unifi wifi");
		expect(wifi.code).toBe(1);
		expect(devices.code).toBe(0);
		expect(apiCalls(home).map((r) => r.path)).toEqual([`/v1/sites/${HOME_SITE.id}/devices`]);
	});

	it("explains a 404 from a server between bundled versions", async () => {
		home.state.version = "10.2.0";
		await lab.run(["instances", "add", "unifi", "home", "--url", home.url, "--api-key", "home-key"]);

		const listed = await lab.run(["unifi", "wifi", "list"]);

		expect(listed.stderr).toContain(
			"(home runs UniFi Network 10.2.0; this command comes from 10.1.84 and may not exist there)",
		);
	});
});
