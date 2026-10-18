import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { unifi } from "./services/unifi/service.ts";
import { startFakeUnifi, type FakeUnifi } from "./testing/fake-unifi.ts";
import { createTestHomelab, type TestHomelab } from "./testing/session.ts";

const SITE = { id: "11111111-1111-4111-8111-111111111111", internalReference: "default", name: "Default" };
const KEY = "s3cret-home-key";

let home: FakeUnifi;
let lab: TestHomelab;

beforeEach(async () => {
	home = await startFakeUnifi({ version: "10.6.106", apiKey: KEY, sites: [SITE], devices: new Map([[SITE.id, []]]) });
	lab = await createTestHomelab([unifi], { env: { UNIFI_KEY: KEY } });
});

afterEach(async () => {
	await home.close();
});

const add = (...flags: string[]) => ["instances", "add", "unifi", "home", "--url", home.url, ...flags];

/** Whether the key is anywhere in the config file. */
async function keyInConfig(): Promise<boolean> {
	return (await readFile(lab.configPath, "utf8").catch(() => "")).includes(KEY);
}

describe("keeping keys", () => {
	it("asks for the key without echoing it, and keeps it in the keyring", async () => {
		const added = await lab.run(add(), { secret: KEY });

		expect(added.code).toBe(0);
		expect(added.asked).toEqual(["UniFi Network API key: "]);
		expect(lab.keyring?.keys.get("unifi/home")).toBe(KEY);
		expect(await keyInConfig()).toBe(false);
		expect((await lab.run(["unifi", "sites", "list"])).code).toBe(0);
	});

	it("needs a way to get the key when there's no terminal to ask on", async () => {
		const added = await lab.run(add());

		expect(added.code).toBe(1);
		expect(added.stderr).toContain(
			"No terminal to ask for the API key on; use --api-key-stdin, --api-key-cmd or --api-key-env",
		);
		expect(await lab.readConfig().catch(() => undefined)).toBeUndefined();
	});

	it("keeps a key from --api-key in the keyring, warning about shell history", async () => {
		const added = await lab.run(add("--api-key", KEY));

		expect(added.stderr).toContain("--api-key stays in your shell history");
		expect(lab.keyring?.keys.get("unifi/home")).toBe(KEY);
		expect(await keyInConfig()).toBe(false);
	});

	it("keeps only the command of --api-key-cmd, and runs it each time", async () => {
		const added = await lab.run(add("--api-key-cmd", `printf '%s\\n' ${KEY}`));

		expect(added.stderr).toContain(`key: command: printf '%s\\n' ${KEY}`);
		expect(lab.keyring?.keys.size).toBe(0);
		expect(await lab.readConfig()).toMatchObject({
			instances: { unifi: { home: { secret: { kind: "command", command: `printf '%s\\n' ${KEY}` } } } },
		});
		const listed = await lab.run(["unifi", "sites", "list"]);
		expect(listed.code).toBe(0);
		expect(home.requests.at(-1)?.apiKey).toBe(KEY);
	});

	it("says which command failed, without the key", async () => {
		await lab.run(add("--api-key-cmd", `printf ${KEY}`));
		await writeFile(
			lab.configPath,
			(await readFile(lab.configPath, "utf8")).replace(`printf ${KEY}`, "echo nope >&2; exit 3"),
		);

		const listed = await lab.run(["unifi", "sites", "list"]);

		expect(listed.code).toBe(1);
		expect(listed.stderr).toContain("unifi@home: `echo nope >&2; exit 3` failed: nope");
	});

	it("keeps only the variable's name for --api-key-env", async () => {
		await lab.run(add("--api-key-env", "UNIFI_KEY"));

		expect(await lab.readConfig()).toMatchObject({
			instances: { unifi: { home: { secret: { kind: "env", name: "UNIFI_KEY" } } } },
		});
		expect(await keyInConfig()).toBe(false);
	});

	it("deletes the key from the keyring when the instance is removed", async () => {
		await lab.run(add(), { secret: KEY });

		await lab.run(["instances", "remove", "unifi", "home"]);

		expect(lab.keyring?.keys.size).toBe(0);
	});
});

describe("without a keyring", () => {
	beforeEach(async () => {
		lab = await createTestHomelab([unifi], { keyring: null });
	});

	it("doesn't fall back to the config file", async () => {
		const added = await lab.run(add(), { secret: KEY });

		expect(added.code).toBe(1);
		expect(added.stderr).toContain("No keyring to keep the key in");
		expect(added.stderr).toContain("--store-in-config");
		expect(added.asked).toEqual([]);
	});

	it("keeps it in the config file when asked to", async () => {
		const added = await lab.run(add("--store-in-config"), { secret: KEY });

		expect(added.code).toBe(0);
		expect(await keyInConfig()).toBe(true);
	});
});
