/**
 * Home Assistant's REST API as OpenAPI 3, written from its documentation
 * (developers.home-assistant.io/docs/api/rest), since Home Assistant
 * publishes no spec. The camera proxy, which sends images, is left out.
 */

const entityId = {
	name: "entity_id",
	in: "path",
	required: true,
	description: "The entity, such as light.kitchen",
	schema: { type: "string" },
};
const timestamp = {
	name: "timestamp",
	in: "path",
	required: true,
	description: "The start of the period (YYYY-MM-DDThh:mm:ssTZD); without it, a day ago",
	schema: { type: "string" },
};
const endTime = {
	name: "end_time",
	in: "query",
	description: "The end of the period (YYYY-MM-DDThh:mm:ssTZD)",
	schema: { type: "string" },
};
const json = (description: string, schema: Record<string, unknown> = {}) => ({
	"200": { description, content: { "application/json": { schema } } },
});
const flag = (name: string, description: string) => ({ name, in: "query", description, schema: { type: "boolean" } });

const historyQuery = [
	{
		name: "filter_entity_id",
		in: "query",
		required: true,
		description: "The entities, comma-separated",
		schema: { type: "string" },
	},
	endTime,
	flag("minimal_response", "Only return last_changed and state for states other than the first and last (much faster)"),
	flag("no_attributes", "Skip returning attributes from the database (much faster)"),
	flag("significant_changes_only", "Only return significant state changes"),
];
const logbookQuery = [
	{ name: "entity", in: "query", description: "Only this entity", schema: { type: "string" } },
	endTime,
];

/** Returns Home Assistant's REST API document. */
export function homeAssistantOpenApi(version: string): unknown {
	return {
		openapi: "3.0.3",
		info: { title: "Home Assistant REST API", version },
		servers: [{ url: "/api" }],
		paths: {
			"/": { get: { summary: "Check that the API is running", responses: json("A message") } },
			"/config": { get: { summary: "Show the configuration", responses: json("The configuration") } },
			"/components": {
				get: {
					summary: "List the loaded components",
					responses: json("The components", { type: "array", items: { type: "string" } }),
				},
			},
			"/events": {
				get: { summary: "List the event types and how many listen to each", responses: json("The event types") },
			},
			"/events/{event_type}": {
				post: {
					summary: "Fire an event",
					parameters: [{ name: "event_type", in: "path", required: true, schema: { type: "string" } }],
					requestBody: {
						required: false,
						description: "The event's data",
						content: { "application/json": { schema: { type: "object" } } },
					},
					responses: json("A message"),
				},
			},
			"/services": { get: { summary: "List the services, by domain", responses: json("The services") } },
			"/services/{domain}/{service}": {
				post: {
					summary: "Call a service",
					parameters: [
						{ name: "domain", in: "path", required: true, description: "Such as light", schema: { type: "string" } },
						{ name: "service", in: "path", required: true, description: "Such as turn_on", schema: { type: "string" } },
						flag("return_response", "Also return the service's response data, for services that have it"),
					],
					requestBody: {
						required: false,
						description: 'The service data, such as {"entity_id": "light.kitchen"}',
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: { entity_id: { type: "string", description: "The entity to act on" } },
								},
							},
						},
					},
					responses: json("The states that changed, and any response data"),
				},
			},
			"/history/period": {
				get: {
					summary: "Show state changes since a day ago",
					parameters: historyQuery,
					responses: json("The state changes, by entity"),
				},
			},
			"/history/period/{timestamp}": {
				get: {
					summary: "Show state changes since a time",
					parameters: [timestamp, ...historyQuery],
					responses: json("The state changes, by entity"),
				},
			},
			"/logbook": {
				get: {
					summary: "Show logbook entries since a day ago",
					parameters: logbookQuery,
					responses: json("The entries"),
				},
			},
			"/logbook/{timestamp}": {
				get: {
					summary: "Show logbook entries since a time",
					parameters: [timestamp, ...logbookQuery],
					responses: json("The entries"),
				},
			},
			"/states": {
				get: {
					summary: "List every entity's state",
					responses: json("The states", { type: "array", items: { type: "object" } }),
				},
			},
			"/states/{entity_id}": {
				get: { summary: "Show an entity's state", parameters: [entityId], responses: json("The state") },
				post: {
					summary: "Set an entity's state in Home Assistant (without acting on the device)",
					parameters: [entityId],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["state"],
									properties: {
										state: { type: "string", description: "The state" },
										attributes: { type: "object", description: "The attributes, as JSON" },
									},
								},
							},
						},
					},
					responses: json("The state"),
				},
				delete: { summary: "Delete an entity", parameters: [entityId], responses: json("A message") },
			},
			"/error_log": {
				get: {
					summary: "Show the errors logged since Home Assistant started",
					responses: { "200": { description: "The log", content: { "text/plain": { schema: { type: "string" } } } } },
				},
			},
			"/calendars": {
				get: {
					summary: "List the calendars",
					responses: json("The calendars", { type: "array", items: { type: "object" } }),
				},
			},
			"/calendars/{entity_id}": {
				get: {
					summary: "List a calendar's events between two times",
					parameters: [
						{ ...entityId, description: "The calendar, such as calendar.holidays" },
						{
							name: "start",
							in: "query",
							required: true,
							description: "The start (YYYY-MM-DDThh:mm:ssTZD)",
							schema: { type: "string" },
						},
						{
							name: "end",
							in: "query",
							required: true,
							description: "The end (YYYY-MM-DDThh:mm:ssTZD)",
							schema: { type: "string" },
						},
					],
					responses: json("The events", { type: "array", items: { type: "object" } }),
				},
			},
			"/template": {
				post: {
					summary: "Render a template",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["template"],
									properties: {
										template: { type: "string", description: "The template, such as {{ states('sun.sun') }}" },
									},
								},
							},
						},
					},
					responses: {
						"200": { description: "The rendered text", content: { "text/plain": { schema: { type: "string" } } } },
					},
				},
			},
			"/config/core/check_config": {
				post: { summary: "Check configuration.yaml", responses: json("Whether it's valid, and its errors") },
			},
			"/intent/handle": {
				post: {
					summary: "Handle an intent (needs intent: in configuration.yaml)",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["name"],
									properties: {
										name: { type: "string", description: "The intent, such as SetTimer" },
										data: { type: "object", description: "Its slots, as JSON" },
									},
								},
							},
						},
					},
					responses: json("The response"),
				},
			},
		},
	};
}
