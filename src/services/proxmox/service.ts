/**
 * Proxmox VE, with an API token (Datacenter → Permissions → API Tokens),
 * given as `user@realm!tokenid=secret`.
 */
import { Result } from "better-result";
import { z } from "zod";
import { ContextUnresolved, UnexpectedResponse } from "../../service.ts";
import { defineService, stringAt } from "../define.ts";
import versions from "./_generated/versions.ts";

const NodesSchema = z.looseObject({ data: z.array(z.looseObject({ node: z.string() })) });

/** Proxmox VE. */
export const service = defineService({
	id: "proxmox",
	title: "Proxmox VE",
	basePath: "/api2/json",
	versions,
	credential: "API token (user@realm!tokenid=secret)",
	auth: (token) => ({ Authorization: `PVEAPIToken=${token}`, Accept: "application/json" }),
	version: { route: "/version", read: (body) => stringAt(body, ["data", "version"]) },
	// Every response is `{ data }`.
	unwrap: (body) => (typeof body === "object" && body !== null && "data" in body ? body.data : body),
	context: [
		{
			wireName: "node",
			flag: "node",
			description: "The node. Defaults to the instance's node, or the only one in the cluster.",
			async resolve(api, given, instanceDefault) {
				const wanted = given ?? instanceDefault;
				if (wanted !== undefined) {
					return Result.ok(wanted);
				}
				const response = await api.get("/nodes");
				if (response.isErr()) {
					return response;
				}
				const nodes = NodesSchema.safeParse(response.value);
				if (!nodes.success) {
					return Result.err(
						new UnexpectedResponse({
							route: "/nodes",
							issues: z.prettifyError(nodes.error),
							message: "/nodes sent no list of nodes",
						}),
					);
				}
				const names = nodes.data.data.map((node) => node.node).sort();
				const [only] = names;
				if (only !== undefined && names.length === 1) {
					return Result.ok(only);
				}
				return Result.err(
					new ContextUnresolved({
						flag: "node",
						message:
							names.length === 0
								? "The cluster has no nodes"
								: `The cluster has ${names.length} nodes; pass --node with one of: ${names.join(", ")}`,
					}),
				);
			},
		},
	],
});
