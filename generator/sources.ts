/**
 * Common places services publish specs: release tags in a git repository,
 * and pages that list versions.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SpecCandidate, SpecSource } from "./spec-config.ts";

const run = promisify(execFile);

/** The options of {@link gitTags}. */
export interface GitTagsOptions {
	/** `owner/name` on GitHub. */
	readonly repo: string;
	/** The release tags, with the version as the first group, such as `/^v(\d+\.\d+\.\d+)$/`. */
	readonly tag: RegExp;
	/** Where the spec is in the repository, tried in order, for specs that moved. */
	readonly paths: readonly string[];
}

/** A spec kept in a GitHub repository, at each release tag. */
export function gitTags(options: GitTagsOptions): SpecSource {
	return {
		async candidates() {
			const { stdout } = await run("git", ["ls-remote", "--tags", "--refs", `https://github.com/${options.repo}`], {
				maxBuffer: 64 * 1024 * 1024,
			});
			const out: SpecCandidate[] = [];
			for (const line of stdout.split("\n")) {
				const tag = line.split("refs/tags/")[1]?.trim();
				const version = tag === undefined ? undefined : options.tag.exec(tag)?.[1];
				if (tag === undefined || version === undefined) {
					continue;
				}
				const urls = options.paths.map((path) => `https://raw.githubusercontent.com/${options.repo}/${tag}/${path}`);
				out.push({ version, urls });
			}
			return out;
		},
	};
}

/** The options of {@link listedVersions}. */
export interface ListedVersionsOptions {
	/** A page that names every version. */
	readonly index: string;
	/** Finds the versions on the page, with the version as the first group; it must have the `g` flag. */
	readonly pattern: RegExp;
	/** Returns the URL of a version's spec. */
	readonly url: (version: string) => string;
}

/** Specs whose versions a page lists, such as a sitemap or a directory listing. */
export function listedVersions(options: ListedVersionsOptions): SpecSource {
	return {
		async candidates() {
			const response = await fetch(options.index);
			if (!response.ok) {
				throw new Error(`${options.index}: ${response.status}`);
			}
			const page = await response.text();
			const versions = new Set([...page.matchAll(options.pattern)].map((match) => match[1] ?? ""));
			versions.delete("");
			return [...versions].map((version) => ({ version, urls: [options.url(version)] }));
		},
	};
}
