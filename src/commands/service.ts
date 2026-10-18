/**
 * `hl <service>[@<instance>] …`: the commands of one service, built from the
 * catalogue of the instance they are for.
 */
import type { Argv, Options, PositionalOptions } from "yargs";
import type { Catalog, CommandSpec, ValueType } from "../catalog.ts";
import { commandShape, describeRequest, prepareRequest, send, sendAllPages } from "../execute.ts";
import { HttpStatusError } from "../http.ts";
import {
	connect,
	instanceNames,
	loadCatalog,
	selectInstance,
	versionIsStale,
	type CatalogChoice,
} from "../instances.ts";
import { OUTPUT_FORMATS, render, renderMany, type InstanceResult, type OutputFormat } from "../output.ts";
import type { ServiceDefinition } from "../service.ts";
import { knownVersion, type Session } from "../session.ts";
import { fail, warn } from "./report.ts";

/** The catalogue the command tree is built from, and the instance it came from. */
export interface TreeSource {
	readonly choice: CatalogChoice;
	/** The instance whose version picked the catalogue, if one could be picked. */
	readonly instance: string | undefined;
}

/**
 * Returns the catalogue to build `service`'s commands from: the one for the
 * instance asked for (or the default), or the newest if there is none yet.
 */
export async function treeSource(
	session: Session,
	service: ServiceDefinition,
	requested: string | undefined,
): Promise<TreeSource> {
	const selected = selectInstance(session.config, service, requested);
	if (selected.isErr()) {
		return { choice: await loadCatalog(service, undefined), instance: undefined };
	}
	// The version saved is enough unless it's stale, so the key (which may
	// mean the keyring or a command) is only needed to ask the server again.
	const { config } = selected.value;
	const saved = config.pinnedVersion ?? config.detected?.version;
	if (config.pinnedVersion !== undefined || !versionIsStale(config, session.now())) {
		return { choice: await loadCatalog(service, saved), instance: selected.value.name };
	}
	const instance = await connect(service, selected.value, session);
	if (instance.isErr()) {
		return { choice: await loadCatalog(service, saved), instance: selected.value.name };
	}
	const known = await knownVersion(session, instance.value);
	return { choice: await loadCatalog(service, known.version), instance: selected.value.name };
}

/** A group of commands in the tree, with its subgroups. */
interface Node {
	readonly name: string;
	description: string;
	readonly children: Map<string, Node>;
	readonly commands: CommandSpec[];
}

/** Registers `service`'s command tree, from `source`'s catalogue, on `yargs`. */
export function registerService(yargs: Argv, session: Session, service: ServiceDefinition, source: TreeSource): Argv {
	const { catalog, match } = source.choice;
	const about =
		source.instance === undefined
			? `Commands from ${service.title} ${catalog.version}.`
			: `Commands for ${service.id}@${source.instance}, from ${service.title} ${catalog.version}${match?.kind === "exact" ? "" : ` (${source.instance} runs ${match === undefined ? "an unknown version" : "a different version"})`}.`;
	return yargs.command(service.id, `${service.title} (also ${service.id}@<instance>)`, (y) => {
		y.usage(`$0 ${service.id}[@<instance>] <command>\n\n${about}`)
			.option("instance", {
				alias: "i",
				type: "string",
				description: "The instance to use (or write <service>@<instance>)",
			})
			.option("all", { type: "boolean", default: false, description: "Run on every instance of the service" })
			.option("output", { alias: "o", choices: OUTPUT_FORMATS, default: "json", description: "How to print results" })
			.option("columns", { type: "string", description: "The columns of a table, comma-separated" })
			.option("yes", {
				alias: "y",
				type: "boolean",
				default: false,
				description: "Don't ask before destructive commands",
			})
			.option("dry-run", { type: "boolean", default: false, description: "Print the request instead of sending it" })
			.group(["instance", "all", "output", "columns", "yes", "dry-run"], "Instance and output:");
		registerNode(y, session, service, tree(catalog));
		return y.demandCommand(1, `Pick a command; see: hl ${service.id} --help`);
	});
}

function registerNode(yargs: Argv, session: Session, service: ServiceDefinition, node: Node): void {
	for (const child of node.children.values()) {
		yargs.command(child.name, child.description, (y) => {
			registerNode(y, session, service, child);
			return y.demandCommand(1, "Pick a command");
		});
	}
	for (const command of node.commands) {
		registerCommand(yargs, session, service, command);
	}
}

function registerCommand(yargs: Argv, session: Session, service: ServiceDefinition, command: CommandSpec): void {
	const shape = commandShape(service, command);
	const name = command.path.at(-1) ?? "";
	const usage = [name, ...shape.positionals.map((param) => `<${param.flag}>`)].join(" ");
	// What the command calls: an HTTP route, or a JSON-RPC method.
	const target =
		command.rpc === undefined
			? `${command.method} ${command.route}`
			: `${command.rpc.method} (JSON-RPC${command.rpc.job ? ", a job: waits for it to finish" : ""})`;
	const summary = command.summary || (command.rpc?.method ?? target);
	yargs.command({
		command: usage,
		describe: command.hidden ? false : `${summary}${command.deprecated ? " (deprecated)" : ""}`,
		builder: (y) => {
			y.usage(
				`$0 ${service.id} ${command.path.join(" ")}${shape.positionals.map((p) => ` <${p.flag}>`).join("")}\n\n${summary}\n\n${target}`,
			);
			for (const param of shape.positionals) {
				y.positional(param.flag, positionalOptions(param.type, param.description));
			}
			for (const { flag, spec } of shape.context) {
				y.option(flag, { type: "string", description: spec.description });
			}
			for (const { flag, spec } of shape.queries) {
				y.option(flag, {
					...flagOptions(spec.type),
					description: firstParagraph(spec.description),
					demandOption: spec.required,
				});
			}
			if (shape.pages) {
				y.option("all-pages", {
					type: "boolean",
					default: false,
					description: "Fetch every page, and print every item",
				});
			}
			if (command.body !== undefined) {
				y.option("body", {
					type: "string",
					description: "The JSON body: JSON, @file, or @- for standard input. Field flags are set over it.",
				});
				for (const { flag, spec } of shape.bodyFields) {
					y.option(flag, { ...flagOptions(spec.type), description: firstParagraph(spec.description) });
				}
				if (shape.bodyFields.length > 0) {
					y.group(
						shape.bodyFields.map((field) => field.flag),
						command.rpc === undefined ? "Body fields:" : "Parameters:",
					);
				}
			}
			if (command.description !== "" && command.description !== summary) {
				y.epilog(command.description);
			}
			return y;
		},
		handler: async (args) => {
			session.exitCode = await runCommand(session, service, command, args);
		},
	});
}

/** Runs `command` on the instances `args` picks, prints the results, and returns the exit code. */
async function runCommand(
	session: Session,
	service: ServiceDefinition,
	command: CommandSpec,
	args: Readonly<Record<string, unknown>>,
): Promise<number> {
	const { io } = session;
	const requested = typeof args["instance"] === "string" ? args["instance"] : undefined;
	const all = args["all"] === true;
	const dryRun = args["dry-run"] === true;
	const format: OutputFormat = args["output"] === "table" ? "table" : "json";
	const columns =
		typeof args["columns"] === "string"
			? args["columns"]
					.split(",")
					.map((c) => c.trim())
					.filter((c) => c !== "")
			: undefined;
	const options = { format, pretty: io.stdout.isTTY, columns };

	let targets: string[];
	if (all) {
		targets = instanceNames(session.config, service.id);
		if (targets.length === 0) {
			const none = selectInstance(session.config, service, undefined);
			return fail(io, none.isErr() ? none.error.message : `No ${service.id} instances`);
		}
	} else {
		const selected = selectInstance(session.config, service, requested);
		if (selected.isErr()) {
			return fail(io, selected.error.message);
		}
		targets = [selected.value.name];
	}

	if (command.confirmation !== undefined && !dryRun && args["yes"] !== true) {
		const what =
			command.confirmation === ""
				? (command.rpc?.method ?? `${command.method} ${command.route}`)
				: command.confirmation;
		const where = targets.map((name) => `${service.id}@${name}`).join(", ");
		const answer = await io.confirm(`${what}\nRun \`${command.path.join(" ")}\` on ${where}?`);
		if (answer === undefined) {
			return fail(io, "This command needs confirmation; pass --yes to run it without a terminal");
		}
		if (!answer) {
			return fail(io, "Cancelled");
		}
	}

	const results: InstanceResult[] = [];
	let failed = false;
	for (const name of targets) {
		const outcome = await runOn(session, service, command, name, args, dryRun);
		if (outcome.kind === "skipped") {
			warn(io, `skipped ${service.id}@${name}: ${outcome.reason}`);
			continue;
		}
		if (outcome.kind === "failed") {
			failed = true;
			fail(io, all ? `${service.id}@${name}: ${outcome.message}` : outcome.message);
			continue;
		}
		results.push({ instance: name, value: outcome.value });
	}
	if (all) {
		io.stdout.write(renderMany(results, options));
	} else if (results[0] !== undefined) {
		io.stdout.write(render(results[0].value, options));
	}
	return failed ? 1 : 0;
}

type Outcome =
	| { readonly kind: "ok"; readonly value: unknown }
	| { readonly kind: "skipped"; readonly reason: string }
	| { readonly kind: "failed"; readonly message: string };

/** Runs `command` on the instance `name`, with the command as that instance's version has it. */
async function runOn(
	session: Session,
	service: ServiceDefinition,
	command: CommandSpec,
	name: string,
	args: Readonly<Record<string, unknown>>,
	dryRun: boolean,
): Promise<Outcome> {
	const selected = selectInstance(session.config, service, name);
	if (selected.isErr()) {
		return { kind: "failed", message: selected.error.message };
	}
	const instance = await connect(service, selected.value, session);
	if (instance.isErr()) {
		return { kind: "failed", message: instance.error.message };
	}
	const known = await knownVersion(session, instance.value);
	if (known.version === undefined && known.probeError !== undefined) {
		warn(
			session.io,
			`couldn't ask ${service.id}@${name} for its version (${known.probeError.message}); using the newest commands`,
		);
	}
	const { catalog, match } = await loadCatalog(service, known.version);
	if (match?.kind === "server-older") {
		warn(
			session.io,
			`${service.id}@${name} runs ${known.version}, older than any ${service.title} version hl has (oldest: ${catalog.version}); some commands may not exist there`,
		);
	}
	const own = findCommand(catalog, command.path);
	if (own === undefined) {
		return { kind: "skipped", reason: `${service.title} ${catalog.version} has no \`${command.path.join(" ")}\`` };
	}
	const request = await prepareRequest(session.io, instance.value, own, args);
	if (request.isErr()) {
		return { kind: "failed", message: request.error.message };
	}
	if (own.rpc !== undefined) {
		if (dryRun) {
			return {
				kind: "ok",
				value: { instance: `${service.id}@${name}`, method: own.rpc.method, params: request.value.body ?? {} },
			};
		}
		if (service.call === undefined) {
			return { kind: "failed", message: `${service.title} has no way to call ${own.rpc.method}` };
		}
		const called = await service.call(instance.value.api, own, request.value.body, catalog.version, match);
		return called.isErr() ? { kind: "failed", message: called.error.message } : { kind: "ok", value: called.value };
	}
	if (dryRun) {
		return { kind: "ok", value: describeRequest(instance.value, request.value) };
	}
	const response =
		args["all-pages"] === true && commandShape(service, own).pages
			? await sendAllPages(instance.value, request.value)
			: await send(instance.value, request.value);
	if (response.isErr()) {
		const error = response.error;
		const hint =
			HttpStatusError.is(error) && error.status === 404 && match !== undefined && match.kind !== "exact"
				? ` (${name} runs ${service.title} ${known.version ?? "?"}; this command comes from ${catalog.version} and may not exist there)`
				: "";
		return { kind: "failed", message: `${error.message}${hint}` };
	}
	return { kind: "ok", value: service.unwrap === undefined ? response.value : service.unwrap(response.value) };
}

/** Returns the command at `path` in `catalog`, if it has one. */
export function findCommand(catalog: Catalog, path: readonly string[]): CommandSpec | undefined {
	const key = path.join(" ");
	return catalog.commands.find((command) => command.path.join(" ") === key);
}

function tree(catalog: Catalog): Node {
	const root: Node = { name: "", description: "", children: new Map(), commands: [] };
	const descriptions = new Map(catalog.groups.map((group) => [group.path.join(" "), group.description]));
	for (const command of catalog.commands) {
		let node = root;
		for (const [i, word] of command.path.slice(0, -1).entries()) {
			let child = node.children.get(word);
			if (child === undefined) {
				const key = command.path.slice(0, i + 1).join(" ");
				child = { name: word, description: descriptions.get(key) ?? "", children: new Map(), commands: [] };
				node.children.set(word, child);
			}
			node = child;
		}
		node.commands.push(command);
	}
	describeGroups(root);
	return root;
}

/** Gives every group without a description one that lists what it has. */
function describeGroups(node: Node): void {
	for (const child of node.children.values()) {
		describeGroups(child);
		if (child.description === "") {
			const names = [...child.children.keys(), ...child.commands.map((command) => command.path.at(-1) ?? "")];
			child.description = names.join(", ");
		}
	}
}

function flagOptions(type: ValueType): Options {
	switch (type.kind) {
		case "string":
		case "json":
			return { type: "string" };
		case "integer":
		case "number":
			return { type: "number" };
		case "boolean":
			return { type: "boolean" };
		case "enum":
			return { type: "string", choices: type.values.map(String) };
		case "array": {
			const elem = flagOptions(type.elem);
			return {
				...elem,
				type: elem.type === "boolean" ? "boolean" : elem.type === "number" ? "number" : "string",
				array: true,
			};
		}
		default:
			return casesHandled(type);
	}
}

function positionalOptions(type: ValueType, description: string): PositionalOptions {
	const kind = type.kind === "integer" || type.kind === "number" ? "number" : "string";
	return { type: kind, description: firstParagraph(description), demandOption: true };
}

function firstParagraph(text: string): string {
	return text.split(/\n\s*\n/)[0]?.trim() ?? "";
}

function casesHandled(unexpected: never): never {
	throw new Error(`unexpected case: ${JSON.stringify(unexpected)}`);
}
