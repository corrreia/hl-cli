/**
 * Runs a catalogue command on an instance: works out its arguments, flags
 * and context, builds the request, and sends it, page by page if asked.
 */
import { readFile } from "node:fs/promises";
import { Result, TaggedError } from "better-result";
import type { BodyFieldSpec, CommandSpec, ParamSpec, ValueType } from "./catalog.ts";
import type { HttpError } from "./http.ts";
import { buildUrl, type Instance } from "./instances.ts";
import type { ContextParam, ContextUnresolved, ServiceDefinition, UnexpectedResponse } from "./service.ts";
import type { Io } from "./session.ts";

/** Flags every service command has, which a generated flag can't take. */
export const RESERVED_FLAGS: ReadonlySet<string> = new Set([
	"all",
	"all-pages",
	"body",
	"columns",
	"dry-run",
	"help",
	"instance",
	"output",
	"version",
	"yes",
]);

/** An argument or flag has a value the command can't take. */
export class InvalidArgument extends TaggedError("InvalidArgument")<{
	readonly flag: string;
	readonly message: string;
}> {}

/** A flag of a command, for a parameter or a body field. */
export interface FlagOf<T> {
	readonly flag: string;
	readonly spec: T;
}

/** How a command takes its inputs on the command line. */
export interface CommandShape {
	/** Path parameters, as positional arguments in route order. */
	readonly positionals: readonly ParamSpec[];
	/** Path parameters taken from context, such as `--site`. */
	readonly context: readonly FlagOf<ContextParam>[];
	readonly queries: readonly FlagOf<ParamSpec>[];
	readonly bodyFields: readonly FlagOf<BodyFieldSpec>[];
	/** Whether `--all-pages` applies. */
	readonly pages: boolean;
}

/** Returns how `command` of `service` takes its inputs. */
export function commandShape(service: ServiceDefinition, command: CommandSpec): CommandShape {
	const pathParams = command.params.filter((param) => param.in === "path");
	const context = service.context
		.filter((ctx) => pathParams.some((param) => param.wireName === ctx.wireName))
		.map((ctx) => ({ flag: ctx.flag, spec: ctx }));
	const positionals = pathParams.filter((param) => !context.some((ctx) => ctx.spec.wireName === param.wireName));
	const taken = new Set([
		...RESERVED_FLAGS,
		...context.map((ctx) => ctx.flag),
		...positionals.map((param) => param.flag),
	]);
	const queries = command.params
		.filter((param) => param.in === "query")
		.map((param) => ({ flag: freeFlag(param.flag, "query", taken), spec: param }));
	const bodyFields = (command.body?.fields ?? []).map((field) => ({
		flag: freeFlag(field.flag, "body", taken),
		spec: field,
	}));
	const pagination = service.pagination;
	const pages =
		pagination !== undefined &&
		queries.some((query) => query.spec.wireName === pagination.offsetParam) &&
		queries.some((query) => query.spec.wireName === pagination.limitParam);
	return { positionals, context, queries, bodyFields, pages };
}

/** Returns `flag`, or `<prefix>-<flag>` if it is taken, and takes it. */
function freeFlag(flag: string, prefix: string, taken: Set<string>): string {
	const free = taken.has(flag) ? `${prefix}-${flag}` : flag;
	taken.add(free);
	return free;
}

/** A request ready to send. */
export interface PreparedRequest {
	readonly method: string;
	readonly route: string;
	readonly query: Readonly<Record<string, readonly string[]>>;
	/** The JSON body, or undefined to send none. */
	readonly body: unknown;
}

/** Returns the request `command` sends on `instance` with `args`, as yargs parsed them. */
export async function prepareRequest(
	io: Io,
	instance: Instance,
	command: CommandSpec,
	args: Readonly<Record<string, unknown>>,
): Promise<Result<PreparedRequest, InvalidArgument | ContextUnresolved | HttpError | UnexpectedResponse>> {
	const shape = commandShape(instance.service, command);
	const pathValues = new Map<string, string>();
	for (const param of shape.positionals) {
		const value = args[param.flag];
		if ((typeof value !== "string" && typeof value !== "number") || value === "") {
			return Result.err(new InvalidArgument({ flag: param.flag, message: `Missing <${param.flag}>` }));
		}
		pathValues.set(param.wireName, String(value));
	}
	for (const { flag, spec } of shape.context) {
		const given = args[flag];
		const resolved = await spec.resolve(
			instance.api,
			typeof given === "string" ? given : undefined,
			instance.config.context[flag],
		);
		if (resolved.isErr()) {
			return resolved;
		}
		pathValues.set(spec.wireName, resolved.value);
	}
	const route = command.route.replace(/\{([^}]+)\}/g, (_match, name: string) =>
		encodeURIComponent(pathValues.get(name) ?? ""),
	);

	const query: Record<string, string[]> = {};
	for (const { flag, spec } of shape.queries) {
		const value = args[flag];
		if (value === undefined) {
			if (spec.required) {
				return Result.err(new InvalidArgument({ flag, message: `Missing --${flag}` }));
			}
			continue;
		}
		const coerced = coerce(flag, spec.type, value);
		if (coerced.isErr()) {
			return coerced;
		}
		query[spec.wireName] = Array.isArray(coerced.value) ? coerced.value.map(queryText) : [queryText(coerced.value)];
	}

	const body = await requestBody(io, command, shape, args);
	if (body.isErr()) {
		return body;
	}
	return Result.ok({ method: command.method, route, query, body: body.value });
}

/** Returns the body to send: `--body`, with the body's field flags set over it. */
async function requestBody(
	io: Io,
	command: CommandSpec,
	shape: CommandShape,
	args: Readonly<Record<string, unknown>>,
): Promise<Result<unknown, InvalidArgument>> {
	if (command.body === undefined) {
		return Result.ok(undefined);
	}
	let body: unknown;
	const raw = args["body"];
	if (typeof raw === "string") {
		const text = await bodyText(io, raw);
		if (text.isErr()) {
			return text;
		}
		try {
			body = JSON.parse(text.value);
		} catch {
			return Result.err(new InvalidArgument({ flag: "body", message: "--body is not valid JSON" }));
		}
	}
	const fields: Record<string, unknown> = {};
	for (const { flag, spec } of shape.bodyFields) {
		const value = args[flag];
		if (value === undefined) {
			continue;
		}
		const coerced = coerce(flag, spec.type, value);
		if (coerced.isErr()) {
			return coerced;
		}
		fields[spec.wireName] = coerced.value;
	}
	if (Object.keys(fields).length > 0) {
		if (body === undefined) {
			body = fields;
		} else if (typeof body === "object" && body !== null && !Array.isArray(body)) {
			body = { ...body, ...fields };
		} else {
			return Result.err(
				new InvalidArgument({ flag: "body", message: "--body must be a JSON object to combine it with field flags" }),
			);
		}
	}
	if (body === undefined && command.body.required) {
		const hint = shape.bodyFields.length > 0 ? " (or its field flags; see --help)" : "";
		return Result.err(new InvalidArgument({ flag: "body", message: `This command needs a body: pass --body${hint}` }));
	}
	return Result.ok(body);
}

/** Returns the text of `--body`: itself, a file's for `@path`, or standard input's for `@-`. */
async function bodyText(io: Io, raw: string): Promise<Result<string, InvalidArgument>> {
	if (raw === "@-" || raw === "-") {
		return Result.ok(await io.readStdin());
	}
	if (!raw.startsWith("@")) {
		return Result.ok(raw);
	}
	const path = raw.slice(1);
	try {
		return Result.ok(await readFile(path, "utf8"));
	} catch {
		return Result.err(new InvalidArgument({ flag: "body", message: `Could not read ${path}` }));
	}
}

/** Returns `value`, as yargs parsed it, as a value of `type`. */
function coerce(flag: string, type: ValueType, value: unknown): Result<unknown, InvalidArgument> {
	const invalid = (expected: string) =>
		Result.err(new InvalidArgument({ flag, message: `--${flag} must be ${expected}, not ${JSON.stringify(value)}` }));
	switch (type.kind) {
		case "string":
			return Result.ok(String(value));
		case "integer":
			return typeof value === "number" && Number.isInteger(value) ? Result.ok(value) : invalid("an integer");
		case "number":
			return typeof value === "number" && !Number.isNaN(value) ? Result.ok(value) : invalid("a number");
		case "boolean":
			return typeof value === "boolean" ? Result.ok(value) : invalid("true or false");
		case "enum": {
			const match = type.values.find((allowed) => String(allowed) === String(value));
			return match === undefined ? invalid(`one of ${type.values.join(", ")}`) : Result.ok(match);
		}
		case "array": {
			const items: unknown[] = [];
			for (const item of Array.isArray(value) ? value : [value]) {
				const coerced = coerce(flag, type.elem, item);
				if (coerced.isErr()) {
					return coerced;
				}
				items.push(coerced.value);
			}
			return Result.ok(items);
		}
		case "json": {
			if (typeof value !== "string") {
				return Result.ok(value);
			}
			try {
				return Result.ok(JSON.parse(value));
			} catch {
				return invalid("JSON");
			}
		}
		default:
			return casesHandled(type);
	}
}

function queryText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** Sends `request` to `instance`, and returns the response body. */
export async function send(instance: Instance, request: PreparedRequest): Promise<Result<unknown, HttpError>> {
	const response = await instance.http.send({
		method: request.method,
		url: buildUrl(instance.baseUrl, request.route, request.query),
		headers:
			request.body === undefined ? instance.headers : { ...instance.headers, "Content-Type": "application/json" },
		body: request.body === undefined ? undefined : JSON.stringify(request.body),
	});
	return response.map((r) => r.body);
}

/**
 * Sends `request` once for every page, the largest pages the service sends,
 * and returns every item.
 */
export async function sendAllPages(
	instance: Instance,
	request: PreparedRequest,
): Promise<Result<unknown[], HttpError | UnexpectedResponse>> {
	const pagination = instance.service.pagination;
	if (pagination === undefined) {
		throw new Error(`${instance.service.id} has no pagination`);
	}
	const items: unknown[] = [];
	for (;;) {
		const query = {
			...request.query,
			[pagination.offsetParam]: [String(items.length)],
			[pagination.limitParam]: [String(pagination.maxLimit)],
		};
		const response = await send(instance, { ...request, query });
		if (response.isErr()) {
			return response;
		}
		const page = pagination.page(response.value);
		if (page.isErr()) {
			return page;
		}
		items.push(...page.value.items);
		const total = page.value.total;
		if (
			page.value.items.length === 0 ||
			(total !== undefined ? items.length >= total : page.value.items.length < pagination.maxLimit)
		) {
			return Result.ok(items);
		}
	}
}

/** Returns the request as `--dry-run` prints it. */
export function describeRequest(instance: Instance, request: PreparedRequest): Record<string, unknown> {
	return {
		instance: `${instance.service.id}@${instance.name}`,
		method: request.method,
		url: buildUrl(instance.baseUrl, request.route, request.query).toString(),
		body: request.body,
	};
}

function casesHandled(unexpected: never): never {
	throw new Error(`unexpected case: ${JSON.stringify(unexpected)}`);
}
