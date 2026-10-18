/**
 * Where Proxmox VE's API schema comes from, and how its operations are named.
 *
 * Proxmox publishes no OpenAPI document; its API viewer's schema ships in the
 * `pve-docs` package of each release, which is converted. A spec version is
 * a minor release (`9.2`), from the newest `pve-docs` of that release.
 */
import { proxmoxToOpenApi } from "../../../generator/convert/proxmox.ts";
import { debianPackage } from "../../../generator/debian.ts";
import { words, type NamedOperation } from "../../../generator/naming.ts";
import type { SpecConfig } from "../../../generator/spec-config.ts";

const VERBS: Readonly<Record<string, string>> = { get: "get", post: "create", put: "update", delete: "delete" };
const COLLECTION_VERBS: Readonly<Record<string, string>> = {
	get: "list",
	post: "create",
	put: "update",
	delete: "delete",
};

/**
 * Names Proxmox operations from their paths. Node-scoped paths drop
 * `/nodes/{node}`, which `--node` sets: `/nodes/{node}/qemu/{vmid}/status/start`
 * is `qemu status start <vmid>`, and node-level ones, such as
 * `/nodes/{node}/status`, are under `node`. The cluster-wide `/storage` is
 * `storage-config`, apart from a node's `storage`.
 */
function name(operation: NamedOperation, all: readonly NamedOperation[]): { group: string; name: string } {
	const segments = operation.route.split("/").filter((segment) => segment !== "");
	const isParam = (segment: string) => segment.startsWith("{");
	let path = segments.filter((segment) => !isParam(segment));
	if (segments[0] === "nodes" && segments[1] === "{node}" && segments.length > 2) {
		path = path.slice(1);
		const [first] = path;
		const collection = first !== undefined && all.some((other) => other.route.startsWith(`/nodes/{node}/${first}/{`));
		if (!collection) {
			path = ["node", ...path];
		}
	} else if (path[0] === "storage") {
		path = ["storage-config", ...path.slice(1)];
	}
	const kebab = path.map((segment) => words(segment).join("-"));
	const last = segments.at(-1);
	if (last !== undefined && isParam(last)) {
		return { group: kebab.join("."), name: VERBS[operation.method] ?? operation.method };
	}
	if (kebab.length <= 1) {
		return { group: kebab[0] ?? "root", name: COLLECTION_VERBS[operation.method] ?? operation.method };
	}
	return { group: kebab.slice(0, -1).join("."), name: kebab.at(-1) ?? "index" };
}

const config: SpecConfig = {
	source: debianPackage({
		repository: "http://download.proxmox.com/debian/pve",
		suites: [
			{
				name: "trixie",
				component: "pve-no-subscription",
				key: "https://enterprise.proxmox.com/debian/proxmox-release-trixie.gpg",
			},
			{
				name: "bookworm",
				component: "pve-no-subscription",
				key: "https://enterprise.proxmox.com/debian/proxmox-release-bookworm.gpg",
			},
			{
				name: "bullseye",
				component: "pve-no-subscription",
				key: "https://enterprise.proxmox.com/debian/proxmox-release-bullseye.gpg",
			},
		],
		package: "pve-docs",
		version: (packageVersion) => /^(\d+\.\d+)/.exec(packageVersion)?.[1],
		file: "usr/share/pve-docs/api-viewer/apidoc.js",
		convert: proxmoxToOpenApi,
	}),
	naming: { group: "path", custom: name },
};

export default config;
