/**
 * Renders results: JSON by default, indented on a terminal and compact when
 * piped, or a table of a list's scalar columns.
 */

/** How to print a result. */
export type OutputFormat = "json" | "table";

/** The formats `--output` takes. */
export const OUTPUT_FORMATS: readonly OutputFormat[] = ["json", "table"];

/** How many columns a table shows when `--columns` doesn't say. */
const DEFAULT_COLUMNS = 8;

/** The options of {@link render}. */
export interface RenderOptions {
	readonly format: OutputFormat;
	/** Whether to indent JSON, as for a terminal. */
	readonly pretty: boolean;
	/** The columns of a table, by property; the first scalar ones when undefined. */
	readonly columns?: readonly string[] | undefined;
}

/** A result from one instance, for output that spans several. */
export interface InstanceResult {
	readonly instance: string;
	readonly value: unknown;
}

/** Returns `value` as text to print, ending with a newline; empty for no value. */
export function render(value: unknown, options: RenderOptions): string {
	if (value === undefined) {
		return "";
	}
	// Text, as from a log or a rendered template, prints as it is.
	if (typeof value === "string") {
		return value.endsWith("\n") ? value : `${value}\n`;
	}
	if (options.format === "table") {
		const rows = listOf(value);
		if (rows !== undefined) {
			return table(rows, options.columns);
		}
	}
	return `${JSON.stringify(value, undefined, options.pretty ? 2 : undefined)}\n`;
}

/**
 * Returns the results of several instances as text: JSON keyed by instance,
 * or one table with an INSTANCE column.
 */
export function renderMany(results: readonly InstanceResult[], options: RenderOptions): string {
	if (options.format === "table") {
		const rows: Record<string, unknown>[] = [];
		for (const result of results) {
			for (const row of listOf(result.value) ?? [result.value]) {
				rows.push({ instance: result.instance, ...(isObject(row) ? row : { value: row }) });
			}
		}
		const columns = options.columns === undefined ? undefined : ["instance", ...options.columns];
		return table(rows, columns);
	}
	const byInstance = Object.fromEntries(results.map((result) => [result.instance, result.value]));
	return `${JSON.stringify(byInstance, undefined, options.pretty ? 2 : undefined)}\n`;
}

/** Returns the rows of a list, or of a page's `data`; undefined if `value` is neither. */
function listOf(value: unknown): readonly unknown[] | undefined {
	if (Array.isArray(value)) {
		return value;
	}
	if (isObject(value) && Array.isArray(value["data"])) {
		return value["data"];
	}
	return undefined;
}

function table(rows: readonly unknown[], columns: readonly string[] | undefined): string {
	if (rows.length === 0) {
		return "(none)\n";
	}
	const keys = columns ?? scalarKeys(rows);
	const cells = rows.map((row) =>
		keys.map((key) => cell(isObject(row) ? row[key] : key === "value" ? row : undefined)),
	);
	const header = keys.map((key) => headerName(key));
	const widths = header.map((name, i) => Math.max(name.length, ...cells.map((line) => (line[i] ?? "").length)));
	const line = (values: readonly string[]) =>
		values
			.map((value, i) => (i === values.length - 1 ? value : value.padEnd(widths[i] ?? 0)))
			.join("  ")
			.trimEnd();
	return `${[line(header), ...cells.map(line)].join("\n")}\n`;
}

/** Returns the properties with scalar values, in the order the rows have them. */
function scalarKeys(rows: readonly unknown[]): string[] {
	const keys: string[] = [];
	for (const row of rows) {
		if (!isObject(row)) {
			return keys.length === 0 ? ["value"] : keys;
		}
		for (const [key, value] of Object.entries(row)) {
			if (!keys.includes(key) && (value === null || typeof value !== "object")) {
				keys.push(key);
			}
		}
	}
	return keys.slice(0, DEFAULT_COLUMNS);
}

function cell(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return `${value}`;
	}
	return JSON.stringify(value) ?? "";
}

/** Returns `macAddress` as `MAC ADDRESS`. */
function headerName(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_]/g, " ")
		.toUpperCase();
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
