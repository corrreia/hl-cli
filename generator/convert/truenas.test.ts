import { describe, expect, it } from "vite-plus/test";
import { parseDump, truenasToOpenApi } from "./truenas.ts";

const dump = {
	versions: [
		{
			version: "v28.0.0",
			methods: [
				{
					name: "pool.query",
					doc: "Query pools. More detail.",
					job: false,
					schemas: {
						properties: {
							"Call parameters": {
								prefixItems: [
									{ title: "filters", type: "array", default: [] },
									{ title: "options", type: "object", default: {} },
								],
							},
							"Return value": { type: "array", discriminator: { mapping: { a: "#/$defs/A" } } },
						},
					},
				},
				{
					name: "pool.dataset.delete",
					doc: "Delete a dataset.",
					job: true,
					schemas: { properties: { "Call parameters": { prefixItems: [{ title: "id", type: "string" }] } } },
				},
				{
					name: "filesystem.put",
					doc: null,
					input_pipes: true,
					schemas: { properties: { "Call parameters": { prefixItems: [] } } },
				},
			],
		},
	],
};

describe("truenasToOpenApi", () => {
	const api = parseDump(dump).get("28.0.0");
	const doc = (api === undefined ? {} : truenasToOpenApi(api, "28.0.0")) as {
		servers: unknown;
		paths: Record<string, { post: Record<string, unknown> }>;
	};

	it("makes each method a POST with its positional parameters as named body fields", () => {
		const query = doc.paths["/pool.query"]?.post;

		expect(query?.["x-hl-rpc"]).toEqual({
			method: "pool.query",
			params: ["filters", "options"],
			job: false,
			defaults: { filters: [], options: {} },
		});
		expect(query?.["requestBody"]).toEqual({
			required: false,
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							filters: { title: "filters", type: "array", default: [] },
							options: { title: "options", type: "object", default: {} },
						},
					},
				},
			},
		});
		expect(query?.["summary"]).toBe("Query pools");
		expect(doc.servers).toEqual([{ url: "/api/v28.0.0" }]);
	});

	it("drops discriminators that map to dropped definitions", () => {
		expect(JSON.stringify(doc.paths["/pool.query"])).not.toContain("$defs");
	});

	it("asks before destructive methods, and marks jobs", () => {
		const remove = doc.paths["/pool.dataset.delete"]?.post;

		expect(remove?.["x-forge-require-confirmation"]).toBe("");
		expect(remove?.["x-hl-rpc"]).toEqual({ method: "pool.dataset.delete", params: ["id"], job: true, defaults: {} });
	});

	it("leaves out methods that stream files", () => {
		expect(doc.paths["/filesystem.put"]).toBeUndefined();
	});
});
