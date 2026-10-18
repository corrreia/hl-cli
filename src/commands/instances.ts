/**
 * `hl instances …` and `hl services`: the servers `hl` knows, and the
 * services and versions it can drive.
 */
import type { Argv } from "yargs";
import { InstanceNameSchema, type Config, type InstanceConfig } from "../config.ts";
import { TlsUnverified } from "../http.ts";
import { connect, connectWithKey, instanceNames, loadCatalog, selectInstance } from "../instances.ts";
import { render } from "../output.ts";
import { describeSecret, resolveSecret, type Keyring, type Secret } from "../secrets.ts";
import type { ServiceDefinition } from "../service.ts";
import { knownVersion, updateConfig, type Session } from "../session.ts";
import { compareVersions } from "../version.ts";
import { done, fail, warn } from "./report.ts";

/** Registers `hl instances` and `hl services` on `yargs`. */
export function registerInstanceCommands(yargs: Argv, session: Session): Argv {
	const serviceIds = () => session.services.map((service) => service.id);
	return yargs
		.command("instances", "Add, list and pick the servers of each service", (y) =>
			y
				.command(
					"add <service> <name>",
					"Add a server, and ask it which version it runs",
					(a) =>
						a
							.positional("service", { type: "string", choices: serviceIds(), demandOption: true })
							.positional("name", {
								type: "string",
								demandOption: true,
								description: "A name for it, such as home or cabin",
							})
							.option("url", {
								type: "string",
								demandOption: true,
								description: "Its URL on the LAN, such as https://192.168.1.1",
							})
							.option("api-key-cmd", {
								type: "string",
								description: 'A command that prints its key, run each time, such as "pass show unifi"',
							})
							.option("api-key-env", {
								type: "string",
								description: "An environment variable to read its key from each time",
							})
							.option("api-key-stdin", {
								type: "boolean",
								default: false,
								description: "Read its key from standard input, and keep it in the keyring",
							})
							.option("api-key", {
								type: "string",
								description: "Its key, kept in the keyring (it stays in your shell history; without it, hl asks)",
							})
							.option("store-in-config", {
								type: "boolean",
								default: false,
								description: "Keep the key in the config file instead of the keyring, for machines without one",
							})
							.group(["api-key-cmd", "api-key-env", "api-key-stdin", "api-key", "store-in-config"], "The key:")
							.option("insecure", {
								type: "boolean",
								default: false,
								description: "Accept a certificate that can't be verified, such as a self-signed one",
							})
							.option("base-path", {
								type: "string",
								description: "Where the API lives under the URL, if not where the service usually has it",
							})
							.option("site", { type: "string", description: "The default site (UniFi)" })
							.option("default", {
								type: "boolean",
								default: false,
								description: "Make it the service's default instance",
							})
							.option("probe", {
								type: "boolean",
								default: true,
								description: "Ask the server for its version (--no-probe to skip)",
							})
							.option("pin-version", {
								type: "string",
								description: "Use this version's commands, for servers that can't say which they run",
							}),
					async (args) => {
						session.exitCode = await add(session, args);
					},
				)
				.command(
					["list [service]", "ls"],
					"List the servers",
					(a) =>
						a
							.positional("service", { type: "string", choices: serviceIds() })
							.option("output", { alias: "o", choices: ["table", "json"] as const, default: "table" as const }),
					(args) => {
						session.exitCode = list(session, args.service, args.output);
					},
				)
				.command(
					["remove <service> <name>", "rm"],
					"Forget a server",
					(a) =>
						a
							.positional("service", { type: "string", choices: serviceIds(), demandOption: true })
							.positional("name", { type: "string", demandOption: true }),
					async (args) => {
						session.exitCode = await remove(session, args.service, args.name);
					},
				)
				.command(
					"use <service> <name>",
					"Make a server the service's default",
					(a) =>
						a
							.positional("service", { type: "string", choices: serviceIds(), demandOption: true })
							.positional("name", { type: "string", demandOption: true }),
					async (args) => {
						session.exitCode = await use(session, args.service, args.name);
					},
				)
				.command(
					"refresh [service] [name]",
					"Ask servers again which version they run",
					(a) =>
						a.positional("service", { type: "string", choices: serviceIds() }).positional("name", { type: "string" }),
					async (args) => {
						session.exitCode = await refresh(session, args.service, args.name);
					},
				)
				.demandCommand(1, "Pick a command; see: hl instances --help"),
		)
		.command(
			"services",
			"List the services hl can drive, and the API versions it has commands for",
			(y) => y.option("output", { alias: "o", choices: ["table", "json"] as const, default: "table" as const }),
			(args) => {
				const rows = session.services.map((service) => ({
					service: service.id,
					title: service.title,
					versions: versionSummary(Object.keys(service.versions).sort(compareVersions), args.output),
					instances: instanceNames(session.config, service.id).join(", "),
				}));
				session.io.stdout.write(render(rows, { format: args.output, pretty: session.io.stdout.isTTY }));
			},
		);
}

interface AddArgs {
	readonly service: string;
	readonly name: string;
	readonly url: string;
	readonly "api-key"?: string | undefined;
	readonly "api-key-cmd"?: string | undefined;
	readonly "api-key-env"?: string | undefined;
	readonly "api-key-stdin": boolean;
	readonly "store-in-config": boolean;
	readonly insecure: boolean;
	readonly "base-path"?: string | undefined;
	readonly site?: string | undefined;
	readonly default: boolean;
	readonly probe: boolean;
	readonly "pin-version"?: string | undefined;
}

async function add(session: Session, args: AddArgs): Promise<number> {
	const { io } = session;
	const service = session.services.find((s) => s.id === args.service);
	if (service === undefined) {
		return fail(io, `Unknown service ${args.service}`);
	}
	const name = InstanceNameSchema.safeParse(args.name);
	if (!name.success) {
		return fail(io, `"${args.name}" can't name an instance: ${name.error.issues[0]?.message ?? "invalid"}`);
	}
	if (session.config.instances[service.id]?.[name.data] !== undefined) {
		return fail(io, `${service.id}@${name.data} already exists; remove it first to change it`);
	}
	let url: URL;
	try {
		url = new URL(args.url);
	} catch {
		return fail(io, `--url ${args.url} is not a URL`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return fail(io, `--url must be http or https`);
	}
	if (args["base-path"] !== undefined && !args["base-path"].startsWith("/")) {
		return fail(io, "--base-path must start with /");
	}
	const key = await obtainKey(session, service, `${service.id}/${name.data}`, args);
	if (key.status === "failed") {
		return fail(io, key.message);
	}
	let instance: InstanceConfig = {
		url: url.toString().replace(/\/+$/, ""),
		secret: key.secret,
		insecure: args.insecure,
		basePath: args["base-path"],
		context: args.site === undefined ? {} : { site: args.site },
		pinnedVersion: args["pin-version"],
	};
	let label = "";
	const probe = service.probeVersion;
	if (args["pin-version"] !== undefined) {
		const { catalog, match } = await loadCatalog(service, args["pin-version"]);
		label = `: pinned to ${service.title} ${args["pin-version"]}${match?.kind === "exact" ? "" : ` (commands from ${catalog.version})`}`;
	} else if (probe === undefined) {
		const { catalog } = await loadCatalog(service, undefined);
		label = `: ${service.title} can't say its version; using ${catalog.version}'s commands (pin one with --pin-version)`;
	} else if (args.probe) {
		const connected = connectWithKey(service, { name: name.data, config: instance }, key.value);
		const probed = await probe(connected.api);
		if (probed.isErr()) {
			const hint = TlsUnverified.is(probed.error) ? "\n  If it uses a self-signed certificate, add --insecure." : "";
			return fail(io, `${probed.error.message}${hint}\n  Not saved; fix it, or add --no-probe to save it anyway.`);
		}
		instance = { ...instance, detected: { version: probed.value, at: session.now().toISOString() } };
		const { catalog, match } = await loadCatalog(service, probed.value);
		label = `: ${service.title} ${probed.value}${match?.kind === "exact" ? "" : ` (commands from ${catalog.version})`}`;
	}
	if (key.keyring !== undefined && key.value !== undefined) {
		const stored = await key.keyring.set(`${service.id}/${name.data}`, key.value);
		if (stored.isErr()) {
			return fail(
				io,
				`${stored.error.message}\n  Not saved; use --api-key-cmd, --api-key-env or --store-in-config instead.`,
			);
		}
	}
	const instances = { ...session.config.instances[service.id], [name.data]: instance };
	const makeDefault = args.default || session.config.defaults[service.id] === undefined;
	const next: Config = {
		instances: { ...session.config.instances, [service.id]: instances },
		defaults: makeDefault ? { ...session.config.defaults, [service.id]: name.data } : session.config.defaults,
	};
	const saved = await updateConfig(session, next);
	if (saved.isErr()) {
		return fail(io, saved.error.message);
	}
	done(
		io,
		`${service.id}@${name.data}${label}${makeDefault ? " — default" : ""}; key: ${describeSecret(instance.secret)}`,
	);
	return 0;
}

/** Where an added instance's key comes from, and the key itself, to ask the server for its version. */
type ObtainedKey =
	| { readonly status: "failed"; readonly message: string }
	| {
			readonly status: "ok";
			readonly secret: Secret | undefined;
			readonly value: string | undefined;
			/** The keyring to keep `value` in, once the instance is saved. */
			readonly keyring: Keyring | undefined;
	  };

/**
 * Works out the key of an instance being added, from the flags: a command or
 * a variable to read it from each time, or the key itself (from
 * `--api-key-stdin`, `--api-key`, or asked for), kept in the keyring unless
 * `--store-in-config`.
 */
async function obtainKey(
	session: Session,
	service: ServiceDefinition,
	account: string,
	args: AddArgs,
): Promise<ObtainedKey> {
	const { io } = session;
	const credential = service.credential ?? "API key";
	const given = [
		args["api-key"] !== undefined,
		args["api-key-cmd"] !== undefined,
		args["api-key-env"] !== undefined,
		args["api-key-stdin"],
	];
	if (given.filter((source) => source).length > 1) {
		return {
			status: "failed",
			message: `Give the ${credential} one way: --api-key-cmd, --api-key-env, --api-key-stdin or --api-key`,
		};
	}

	// Read each time from where it is: nothing to keep.
	const reference: Secret | undefined =
		args["api-key-cmd"] !== undefined
			? { kind: "command", command: args["api-key-cmd"] }
			: args["api-key-env"] !== undefined
				? { kind: "env", name: args["api-key-env"] }
				: undefined;
	if (reference !== undefined) {
		if (args["store-in-config"]) {
			return {
				status: "failed",
				message:
					"--store-in-config keeps a key given with --api-key-stdin, --api-key or when asked; not a command or variable",
			};
		}
		const value = await resolveSecret(reference, session);
		return value.isErr()
			? { status: "failed", message: value.error.message }
			: { status: "ok", secret: reference, value: value.value, keyring: undefined };
	}

	const noneGiven = !args["api-key-stdin"] && args["api-key"] === undefined;
	if (noneGiven && service.authOptional === true) {
		return { status: "ok", secret: undefined, value: undefined, keyring: undefined };
	}

	// The key itself: check where it will be kept before asking for it.
	let keyring: Keyring | undefined;
	if (!args["store-in-config"]) {
		const found = await session.keyring();
		if (found.isErr()) {
			return {
				status: "failed",
				message: `No keyring to keep the key in: ${found.error.message}.\n  Use --api-key-cmd or --api-key-env, or --store-in-config to keep it in the config file.`,
			};
		}
		keyring = found.value;
	}
	let value: string | undefined;
	if (args["api-key-stdin"]) {
		value = (await io.readStdin()).trim();
	} else if (args["api-key"] !== undefined) {
		warn(io, "--api-key stays in your shell history; next time, leave it out and hl asks for the key");
		value = args["api-key"];
	} else {
		value = (await io.askSecret(`${service.title} ${credential}: `))?.trim();
		if (value === undefined) {
			return {
				status: "failed",
				message: `No terminal to ask for the ${credential} on; use --api-key-stdin, --api-key-cmd or --api-key-env`,
			};
		}
	}
	if (value === "") {
		return { status: "failed", message: `No ${credential} given` };
	}
	return {
		status: "ok",
		secret: keyring === undefined ? { kind: "file", value } : { kind: "keyring", account },
		value,
		keyring,
	};
}

function list(session: Session, serviceId: string | undefined, format: "table" | "json"): number {
	const rows: Record<string, unknown>[] = [];
	for (const service of session.services) {
		if (serviceId !== undefined && service.id !== serviceId) {
			continue;
		}
		for (const name of instanceNames(session.config, service.id)) {
			const instance = session.config.instances[service.id]?.[name];
			if (instance === undefined) {
				continue;
			}
			rows.push({
				service: service.id,
				name,
				default: session.config.defaults[service.id] === name ? "*" : "",
				url: instance.url,
				version: instance.pinnedVersion ?? instance.detected?.version ?? "",
				key: describeSecret(instance.secret),
				checked: instance.detected?.at ?? "",
				...(format === "json" ? { insecure: instance.insecure, context: instance.context } : {}),
			});
		}
	}
	if (rows.length === 0 && format === "table") {
		session.io.stderr.write(`No instances yet; add one with: hl instances add <service> <name> --url <url>\n`);
		return 0;
	}
	session.io.stdout.write(render(rows, { format, pretty: session.io.stdout.isTTY }));
	return 0;
}

async function remove(session: Session, serviceId: string, name: string): Promise<number> {
	const instances = session.config.instances[serviceId] ?? {};
	const instance = instances[name];
	if (instance === undefined) {
		return fail(session.io, `No ${serviceId} instance named "${name}"`);
	}
	if (instance.secret?.kind === "keyring") {
		const keyring = await session.keyring();
		const deleted = keyring.isErr() ? undefined : await keyring.value.delete(instance.secret.account);
		if (deleted === undefined || deleted.isErr()) {
			warn(
				session.io,
				`Couldn't delete ${instance.secret.account}'s key from the keyring; delete it there (service hl)`,
			);
		}
	}
	const rest = Object.fromEntries(Object.entries(instances).filter(([key]) => key !== name));
	const defaults = Object.fromEntries(
		Object.entries(session.config.defaults).filter(([key, value]) => key !== serviceId || value !== name),
	);
	const saved = await updateConfig(session, {
		instances: { ...session.config.instances, [serviceId]: rest },
		defaults,
	});
	if (saved.isErr()) {
		return fail(session.io, saved.error.message);
	}
	done(session.io, `Removed ${serviceId}@${name}`);
	return 0;
}

async function use(session: Session, serviceId: string, name: string): Promise<number> {
	if (session.config.instances[serviceId]?.[name] === undefined) {
		return fail(session.io, `No ${serviceId} instance named "${name}"`);
	}
	const saved = await updateConfig(session, {
		...session.config,
		defaults: { ...session.config.defaults, [serviceId]: name },
	});
	if (saved.isErr()) {
		return fail(session.io, saved.error.message);
	}
	done(session.io, `${serviceId}@${name} is the default`);
	return 0;
}

async function refresh(session: Session, serviceId: string | undefined, name: string | undefined): Promise<number> {
	let code = 0;
	const services: readonly ServiceDefinition[] = session.services.filter(
		(service) => serviceId === undefined || service.id === serviceId,
	);
	for (const service of services) {
		const names = name === undefined ? instanceNames(session.config, service.id) : [name];
		for (const instanceName of names) {
			const selected = selectInstance(session.config, service, instanceName);
			if (selected.isErr()) {
				code = fail(session.io, selected.error.message);
				continue;
			}
			const connected = await connect(service, selected.value, session);
			if (connected.isErr()) {
				code = fail(session.io, connected.error.message);
				continue;
			}
			const known = await knownVersion(session, connected.value, true);
			if (known.probeError !== undefined) {
				code = fail(session.io, `${service.id}@${instanceName}: ${known.probeError.message}`);
				continue;
			}
			const { catalog, match } = await loadCatalog(service, known.version);
			done(
				session.io,
				`${service.id}@${instanceName}: ${service.title} ${known.version ?? "?"}${match?.kind === "exact" ? "" : ` (commands from ${catalog.version})`}`,
			);
			if (match?.kind === "server-older") {
				warn(session.io, `${service.id}@${instanceName} is older than any version hl has commands for`);
			}
		}
	}
	return code;
}

/** Returns the versions as a table shows them, `15: 9.1.120 – 10.6.106`, or all of them for JSON. */
function versionSummary(versions: readonly string[], format: "table" | "json"): string | readonly string[] {
	if (format === "json") {
		return versions;
	}
	const [first] = versions;
	const last = versions.at(-1);
	return first === undefined || last === undefined || first === last
		? (first ?? "")
		: `${versions.length}: ${first} – ${last}`;
}
