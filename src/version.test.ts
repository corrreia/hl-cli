import { describe, expect, it } from "vite-plus/test";
import { compareVersions, pickVersion } from "./version.ts";

describe("compareVersions", () => {
	it("compares numbers part by part, not as text", () => {
		expect(compareVersions("10.6.106", "9.4.19")).toBeGreaterThan(0);
		expect(compareVersions("10.6.9", "10.6.106")).toBeLessThan(0);
		expect(compareVersions("10.6", "10.6.0")).toBe(0);
		expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
	});
});

describe("pickVersion", () => {
	const available = ["9.4.19", "10.6.106", "10.10.0"];

	it("picks the exact version", () => {
		expect(pickVersion(available, "10.6.106")).toEqual({ kind: "exact", version: "10.6.106" });
	});

	it("picks the newest catalogue not newer than the server", () => {
		expect(pickVersion(available, "10.8.1")).toEqual({ kind: "older", version: "10.6.106" });
		expect(pickVersion(available, "11.0.0")).toEqual({ kind: "older", version: "10.10.0" });
	});

	it("picks the oldest catalogue for a server older than all of them", () => {
		expect(pickVersion(available, "8.0.0")).toEqual({ kind: "server-older", version: "9.4.19" });
	});
});
