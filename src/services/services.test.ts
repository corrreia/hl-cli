import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vite-plus/test";
import { createTestHomelab } from "../testing/session.ts";
import { SERVICES } from "./registry.ts";

describe.each(SERVICES.map((service) => [service.id, service] as const))("%s", (_id, service) => {
	it("has a catalogue for every bundled version, with commands that don't clash", async () => {
		const versions = Object.entries(service.versions);
		expect(versions.length).toBeGreaterThan(0);
		for (const [version, load] of versions) {
			const { default: catalog } = await load();
			expect(catalog.version).toBe(version);
			expect(catalog.commands.length).toBeGreaterThan(0);

			const paths = catalog.commands.map((command) => command.path.join(" "));
			expect(new Set(paths).size, `${version}: two commands with one name`).toBe(paths.length);
			const groups = new Set(
				catalog.commands.flatMap((command) =>
					command.path.slice(0, -1).map((_, i) => command.path.slice(0, i + 1).join(" ")),
				),
			);
			const clashing = paths.filter((path) => groups.has(path));
			expect(clashing, `${version}: commands named like groups`).toEqual([]);
		}
	});
});

/** What each service's server answers where it says its version, and the version that is. */
const PROBES: Readonly<Record<string, { readonly route: string; readonly body: unknown; readonly version: string }>> = {
	jellyfin: { route: "/System/Info/Public", body: { Version: "10.11.11", ServerName: "jf" }, version: "10.11.11" },
	immich: { route: "/api/server/version", body: { major: 3, minor: 3, patch: 1 }, version: "3.3.1" },
	sonarr: { route: "/api/v3/system/status", body: { version: "4.0.19.3007" }, version: "4.0.19.3007" },
	radarr: { route: "/api/v3/system/status", body: { version: "6.4.4.10685" }, version: "6.4.4.10685" },
	lidarr: { route: "/api/v1/system/status", body: { version: "3.1.6.5078" }, version: "3.1.6.5078" },
	prowlarr: { route: "/api/v1/system/status", body: { version: "2.6.5.5623" }, version: "2.6.5.5623" },
	seerr: { route: "/api/v1/status", body: { version: "3.5.0", commitTag: "v3.5.0" }, version: "3.5.0" },
	overseerr: { route: "/api/v1/status", body: { version: "1.35.0" }, version: "1.35.0" },
	adguard: { route: "/control/status", body: { version: "v0.107.79", running: true }, version: "0.107.79" },
	grafana: { route: "/api/health", body: { database: "ok", version: "13.2.4" }, version: "13.2.4" },
	authentik: { route: "/api/v3/admin/version/", body: { version_current: "2026.8.4" }, version: "2026.8.4" },
	frigate: { route: "/api/version", body: "0.18.2-6e0b2f1", version: "0.18.2" },
	kavita: { route: "/api/Plugin/version", body: "0.9.1.4", version: "0.9.1.4" },
	komga: { route: "/actuator/info", body: { build: { version: "1.24.3" } }, version: "1.24.3" },
	audiobookshelf: { route: "/status", body: { isInit: true, serverVersion: "2.37.1" }, version: "2.37.1" },
	proxmox: {
		route: "/api2/json/version",
		body: { data: { version: "9.2.4", release: "9.2", repoid: "abcd1234" } },
		version: "9.2.4",
	},
	portainer: { route: "/api/system/status", body: { InstanceID: "x", Version: "2.45.2" }, version: "2.45.2" },
	"home-assistant": {
		route: "/api/config",
		body: { version: "2026.10.1", location_name: "Home" },
		version: "2026.10.1",
	},
};

/** Serves `probe` on localhost while `run` runs, and returns what `run` returns. */
async function serving<T>(probe: (typeof PROBES)[string], run: (url: string) => Promise<T>): Promise<T> {
	const server = createServer((req, res) => {
		if (req.url !== probe.route) {
			res.writeHead(404).end();
			return;
		}
		const json = typeof probe.body !== "string";
		res.writeHead(200, { "content-type": json ? "application/json" : "text/plain" });
		res.end(json ? JSON.stringify(probe.body) : probe.body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo; // SAFETY: a TCP server listening on a port has an AddressInfo.
	try {
		return await run(`http://127.0.0.1:${port}`);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

describe("version probes", () => {
	it.each(Object.entries(PROBES))("reads %s's version", async (id, probe) => {
		const service = SERVICES.find((s) => s.id === id);
		const lab = await createTestHomelab(service === undefined ? [] : [service]);

		const added = await serving(probe, (url) =>
			lab.run(["instances", "add", id, "box", "--url", url, "--api-key", "k"]),
		);

		expect(added.stderr).toContain(`${id}@box: `);
		expect(await lab.readConfig()).toMatchObject({
			instances: { [id]: { box: { detected: { version: probe.version } } } },
		});
	});

	it("covers every service that can say its version", () => {
		const probing = SERVICES.filter((service) => service.probeVersion !== undefined && service.id !== "unifi").map(
			(s) => s.id,
		);

		expect(Object.keys(PROBES).sort()).toEqual(probing.sort());
	});
});
