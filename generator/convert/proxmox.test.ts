import { describe, expect, it } from "vite-plus/test";
import { proxmoxToOpenApi } from "./proxmox.ts";

const apidoc = `const apiSchema = [
   {
      "path" : "/nodes",
      "children" : [
         {
            "path" : "/nodes/{node}/qemu/{vmid}/config",
            "info" : {
               "GET" : {
                  "name" : "vm_config",
                  "description" : "Get the VM configuration.",
                  "parameters" : { "properties" : {
                     "node" : { "type" : "string" },
                     "vmid" : { "type" : "integer", "minimum" : "100" },
                     "current" : { "type" : "boolean", "optional" : 1, "default" : 0 }
                  } },
                  "returns" : { "type" : "object" }
               },
               "PUT" : {
                  "name" : "update_vm",
                  "description" : "Set options.\\nMore detail.",
                  "parameters" : { "properties" : {
                     "node" : { "type" : "string" },
                     "vmid" : { "type" : "integer" },
                     "net[n]" : { "type" : "string", "optional" : 1 },
                     "cores" : { "type" : "integer", "optional" : "1" },
                     "name" : { "type" : "string" }
                  } },
                  "returns" : { "type" : "null" }
               }
            }
         }
      ]
   }
]
;
let method2cmd = {};`;

describe("proxmoxToOpenApi", () => {
	const doc = proxmoxToOpenApi(apidoc, "9.2") as {
		paths: Record<
			string,
			Record<string, { parameters: unknown[]; requestBody?: unknown; summary: string; responses: unknown }>
		>;
	};
	const config = doc.paths["/nodes/{node}/qemu/{vmid}/config"];

	it("makes GET parameters query parameters, and path ones path parameters", () => {
		expect(config?.["get"]?.parameters).toEqual([
			{ name: "node", in: "path", required: true, schema: { type: "string" } },
			{ name: "vmid", in: "path", required: true, schema: { type: "integer", minimum: 100 } },
			{ name: "current", in: "query", required: false, schema: { type: "boolean", default: 0 } },
		]);
	});

	it("makes PUT parameters a JSON body, with numbered ones spelled out", () => {
		const body = config?.["put"]?.requestBody as {
			content: { "application/json": { schema: { properties: object; required: string[] } } };
		};
		const schema = body.content["application/json"].schema;

		expect(Object.keys(schema.properties)).toEqual([
			"net0",
			"net1",
			"net2",
			"net3",
			"net4",
			"net5",
			"net6",
			"net7",
			"cores",
			"name",
		]);
		expect(schema.required).toEqual(["name"]);
		expect(config?.["put"]?.summary).toBe("Set options.");
	});

	it("wraps responses in data", () => {
		expect(config?.["get"]?.responses).toEqual({
			"200": {
				description: "OK",
				content: { "application/json": { schema: { type: "object", properties: { data: { type: "object" } } } } },
			},
		});
	});
});
