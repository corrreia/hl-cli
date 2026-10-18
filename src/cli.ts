/**
 * The command line: `hl <command>`, run against a {@link Session}.
 */
import yargs from "yargs";
import packageJson from "../package.json" with { type: "json" };
import { registerInstanceCommands } from "./commands/instances.ts";
import { fail } from "./commands/report.ts";
import { registerService, treeSource } from "./commands/service.ts";
import type { ServiceDefinition } from "./service.ts";
import type { Session } from "./session.ts";

/** Runs `hl` with `args`, the arguments after the program, and returns the exit code. */
export async function main(args: readonly string[], session: Session): Promise<number> {
	const expanded = expandInstance(args, session.services);
	const target = session.services.find((service) => service.id === expanded[0]);

	let parser = yargs([...expanded])
		.scriptName("hl")
		.usage("$0 <service>[@<instance>] <command>\n\nOne CLI for the self-hosted services in your homelab.")
		.parserConfiguration({ "camel-case-expansion": false })
		.strict()
		.exitProcess(false)
		.wrap(Math.min(120, process.stdout.columns || 100))
		.help()
		.alias("h", "help")
		.version(packageJson.version)
		.recommendCommands()
		.demandCommand(1, "Pick a command; see: hl --help");
	parser = registerInstanceCommands(parser, session);
	for (const service of session.services) {
		if (service === target) {
			const source = await treeSource(session, service, requestedInstance(expanded));
			parser = registerService(parser, session, service, source);
		} else {
			// Only the service a run is for loads its catalogue; the others are listed.
			parser = parser.command(service.id, `${service.title} (also ${service.id}@<instance>)`);
		}
	}

	let failure: string | undefined;
	parser = parser.fail((message, error) => {
		failure = message ?? (error instanceof Error ? error.message : "Invalid command");
	});
	let output = "";
	await parser.parseAsync([...expanded], {}, (_error, _argv, text) => {
		output = text;
	});
	if (failure !== undefined) {
		if (output !== "" && output !== failure) {
			session.io.stderr.write(`${output.replace(/\n*$/, "")}\n\n`);
		}
		return fail(session.io, failure);
	}
	if (output !== "") {
		session.io.stdout.write(`${output.replace(/\n*$/, "")}\n`);
	}
	return session.exitCode;
}

/** Returns `args` with `<service>@<instance>` written as `<service> --instance <instance>`. */
export function expandInstance(args: readonly string[], services: readonly ServiceDefinition[]): string[] {
	const [first, ...rest] = args;
	if (first === undefined) {
		return [];
	}
	const at = first.indexOf("@");
	if (at <= 0 || !services.some((service) => service.id === first.slice(0, at))) {
		return [...args];
	}
	return [first.slice(0, at), "--instance", first.slice(at + 1), ...rest];
}

/** Returns the instance `--instance` (or `-i`) names in `args`, if any. */
function requestedInstance(args: readonly string[]): string | undefined {
	for (const [i, arg] of args.entries()) {
		if (arg === "--instance" || arg === "-i") {
			return args[i + 1];
		}
		if (arg.startsWith("--instance=")) {
			return arg.slice("--instance=".length);
		}
	}
	return undefined;
}
