/**
 * How commands report failures and warnings: one line each, on standard error.
 */
import type { Io } from "../session.ts";

/** Prints `message` as a failure, and returns the exit code for one. */
export function fail(io: Io, message: string): number {
	io.stderr.write(`✗ ${message}\n`);
	return 1;
}

/** Prints `message` as a warning. */
export function warn(io: Io, message: string): void {
	io.stderr.write(`⚠ ${message}\n`);
}

/** Prints `message` as a success, on standard error so standard output stays data. */
export function done(io: Io, message: string): void {
	io.stderr.write(`✓ ${message}\n`);
}
