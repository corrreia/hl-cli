/**
 * Home Assistant's REST API, written by hand from its documentation (see
 * `openapi.ts`), with every command named by hand. The REST API has been
 * stable for years, so there is one version.
 */
import type { SpecConfig } from "../../../generator/spec-config.ts";
import { homeAssistantOpenApi } from "./openapi.ts";

const VERSION = "2023.1.0";

const config: SpecConfig = {
	source: {
		candidates: () =>
			Promise.resolve([{ version: VERSION, urls: [], load: () => Promise.resolve(homeAssistantOpenApi(VERSION)) }]),
	},
	overrides: {
		"GET /": { group: "api", method: "status" },
		"GET /config": { group: "config", method: "get" },
		"POST /config/core/check_config": { group: "config", method: "check" },
		"GET /components": { group: "components", method: "list" },
		"GET /events": { group: "events", method: "list" },
		"POST /events/{event_type}": { group: "events", method: "fire" },
		"GET /services": { group: "services", method: "list" },
		"POST /services/{domain}/{service}": { group: "services", method: "call" },
		"GET /history/period": { group: "history", method: "list" },
		"GET /history/period/{timestamp}": { group: "history", method: "since" },
		"GET /logbook": { group: "logbook", method: "list" },
		"GET /logbook/{timestamp}": { group: "logbook", method: "since" },
		"GET /states": { group: "states", method: "list" },
		"GET /states/{entity_id}": { group: "states", method: "get" },
		"POST /states/{entity_id}": { group: "states", method: "set" },
		"DELETE /states/{entity_id}": {
			group: "states",
			method: "delete",
			confirm: "This deletes the entity from Home Assistant's state machine.",
		},
		"GET /error_log": { group: "logs", method: "errors" },
		"GET /calendars": { group: "calendars", method: "list" },
		"GET /calendars/{entity_id}": { group: "calendars", method: "events" },
		"POST /template": { group: "template", method: "render" },
		"POST /intent/handle": { group: "intent", method: "handle" },
	},
};

export default config;
