import { describe, expect, it } from "vite-plus/test";
import { deriveOverlay, words, type NamedOperation } from "./naming.ts";

function op(method: string, route: string, tags: readonly string[], operationId?: string): NamedOperation {
	return { method, route, tags, operationId };
}

describe("words", () => {
	it("splits camel, Pascal, snake and kebab case", () => {
		expect(words("getAllAlbums")).toEqual(["get", "all", "albums"]);
		expect(words("GetItemImageInfos")).toEqual(["get", "item", "image", "infos"]);
		expect(words("HTTPServerStatus")).toEqual(["http", "server", "status"]);
		expect(words("admin_provisioning-reload")).toEqual(["admin", "provisioning", "reload"]);
		expect(words("Users (admin)")).toEqual(["users", "admin"]);
	});
});

describe("deriveOverlay", () => {
	it("names from operationIds without the group's words", () => {
		const overlay = deriveOverlay(
			[
				op("get", "/assets/statistics", ["Assets"], "getAssetStatistics"),
				op("get", "/albums", ["Albums"], "getAllAlbums"),
				op("put", "/admin/users/{id}/preferences", ["Users (admin)"], "updateUserPreferencesAdmin"),
			],
			{ group: "tag" },
		);

		expect(overlay).toEqual({
			getAssetStatistics: { group: "assets", method: "get-statistics" },
			getAllAlbums: { group: "albums", method: "get-all" },
			updateUserPreferencesAdmin: { group: "users-admin", method: "update-preferences" },
		});
	});

	it("names CRUD routes without operationIds from the method and path", () => {
		const overlay = deriveOverlay(
			[
				op("get", "/api/v3/series", ["Series"]),
				op("post", "/api/v3/series", ["Series"]),
				op("get", "/api/v3/series/{id}", ["Series"]),
				op("put", "/api/v3/series/{id}", ["Series"]),
				op("delete", "/api/v3/series/{id}", ["Series"]),
				op("get", "/api/v3/series/lookup", ["Series"]),
				op("get", "/api/v3/alttitle/{id}", ["AlternativeTitle"]),
			],
			{ group: "tag", prefix: /^\/api\/v3/ },
		);

		expect(overlay).toEqual({
			"GET /api/v3/series": { group: "series", method: "list" },
			"POST /api/v3/series": { group: "series", method: "create" },
			"GET /api/v3/series/{id}": { group: "series", method: "get" },
			"PUT /api/v3/series/{id}": { group: "series", method: "update" },
			"DELETE /api/v3/series/{id}": { group: "series", method: "delete" },
			"GET /api/v3/series/lookup": { group: "series", method: "lookup" },
			"GET /api/v3/alttitle/{id}": { group: "alternative-title", method: "get" },
		});
	});

	it("lengthens clashing names: the path parameter, then the verb", () => {
		const overlay = deriveOverlay(
			[
				op("put", "/api/v1/indexer/bulk", ["Indexer"]),
				op("delete", "/api/v1/indexer/bulk", ["Indexer"]),
				op("get", "/api/v1/indexer/schema", ["Indexer"]),
				op("get", "/api/v1/indexer/schema/{id}", ["Indexer"]),
			],
			{ group: "tag", prefix: /^\/api\/v1/ },
		);

		expect(overlay).toEqual({
			"PUT /api/v1/indexer/bulk": { group: "indexer", method: "bulk-update" },
			"DELETE /api/v1/indexer/bulk": { group: "indexer", method: "bulk-delete" },
			"GET /api/v1/indexer/schema": { group: "indexer", method: "schema" },
			"GET /api/v1/indexer/schema/{id}": { group: "indexer", method: "schema-by-id" },
		});
	});

	it("keeps the plain name for the one GET of a clash", () => {
		const overlay = deriveOverlay(
			[
				op("get", "/qemu/{vmid}/config", []),
				op("post", "/qemu/{vmid}/config", []),
				op("put", "/qemu/{vmid}/config", []),
			],
			{
				group: "path",
				custom: (operation) => ({ group: "qemu", name: words(operation.route.split("/").at(-1) ?? "").join("-") }),
			},
		);

		expect(Object.values(overlay).map((entry) => entry.method)).toEqual(["config", "config-create", "config-update"]);
	});

	it("uses the whole operationId when names without the group's words clash", () => {
		const overlay = deriveOverlay(
			[op("get", "/Genres/{name}", ["Genres"], "GetGenre"), op("get", "/Genres", ["Genres"], "GetGenres")],
			{ group: "tag" },
		);

		expect(overlay).toEqual({
			GetGenre: { group: "genres", method: "get-genre" },
			GetGenres: { group: "genres", method: "get-genres" },
		});
	});

	it("skips path segments up to the one that names the group", () => {
		const overlay = deriveOverlay(
			[
				op("get", "/api/v3/system/backup", ["Backup"]),
				op("post", "/api/v3/system/backup/restore/{id}", ["Backup"]),
				op("get", "/api/Book/{chapterId}/book-info", ["Book"]),
			],
			{ group: "tag", prefix: /^\/api(\/v3)?/ },
		);

		expect(overlay).toEqual({
			"GET /api/v3/system/backup": { group: "backup", method: "list" },
			"POST /api/v3/system/backup/restore/{id}": { group: "backup", method: "restore" },
			"GET /api/Book/{chapterId}/book-info": { group: "book", method: "info" },
		});
	});

	it("drops Spring's controller suffix and numbered operationIds", () => {
		const overlay = deriveOverlay([op("get", "/api/v1/books/{id}/file", ["book-controller"], "getFile_1")], {
			group: "tag",
		});

		expect(overlay).toEqual({ getFile_1: { group: "book", method: "get-file" } });
	});

	it("names the same operations the same way every time", () => {
		const operations = [op("get", "/a", ["A"]), op("get", "/a/b", ["A"]), op("post", "/a/b", ["A"])];

		expect(deriveOverlay(operations, { group: "tag" })).toEqual(
			deriveOverlay([...operations].reverse(), { group: "tag" }),
		);
	});
});
