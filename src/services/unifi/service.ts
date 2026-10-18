/**
 * UniFi Network, through the Network application's integration API on a
 * UniFi console (or a self-hosted Network server), with an API key made in
 * the Network app under Settings → Control Plane → Integrations.
 */
import { Result } from "better-result";
import { z } from "zod";
import { ContextUnresolved, UnexpectedResponse, type ServiceApi, type ServiceDefinition } from "../../service.ts";
import versions from "./_generated/versions.ts";

const InfoSchema = z.looseObject({ applicationVersion: z.string().min(1) });

const SiteSchema = z.looseObject({ id: z.string(), internalReference: z.string(), name: z.string() });
const SitesSchema = z.looseObject({ data: z.array(SiteSchema) });

const PageSchema = z.looseObject({ data: z.array(z.unknown()), totalCount: z.number().optional() });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UniFi Network. */
export const unifi: ServiceDefinition = {
	id: "unifi",
	title: "UniFi Network",
	basePath: "/proxy/network/integration",
	versions,

	authHeaders(apiKey) {
		return { "X-API-KEY": apiKey, Accept: "application/json" };
	},

	async probeVersion(api) {
		const response = await api.get("/v1/info");
		if (response.isErr()) {
			return response;
		}
		const info = InfoSchema.safeParse(response.value);
		if (!info.success) {
			return Result.err(
				new UnexpectedResponse({
					route: "/v1/info",
					issues: z.prettifyError(info.error),
					message: "/v1/info sent no applicationVersion",
				}),
			);
		}
		return Result.ok(info.data.applicationVersion);
	},

	context: [
		{
			wireName: "siteId",
			flag: "site",
			description:
				"The site: its name, internal reference (such as `default`) or id. Defaults to the instance's site, or the only one.",
			async resolve(api, given, instanceDefault) {
				const wanted = given ?? instanceDefault;
				if (wanted !== undefined && UUID.test(wanted)) {
					return Result.ok(wanted);
				}
				const sites = await listSites(api);
				if (sites.isErr()) {
					return sites;
				}
				const names = sites.value.map((site) =>
					site.internalReference === site.name ? site.name : `${site.name} (${site.internalReference})`,
				);
				if (wanted === undefined) {
					const [only] = sites.value;
					if (only !== undefined && sites.value.length === 1) {
						return Result.ok(only.id);
					}
					return Result.err(
						new ContextUnresolved({
							flag: "site",
							message:
								sites.value.length === 0
									? "The console has no sites"
									: `The console has ${sites.value.length} sites; pass --site with one of: ${names.join(", ")}`,
						}),
					);
				}
				const lower = wanted.toLowerCase();
				const site = sites.value.find(
					(s) => s.name.toLowerCase() === lower || s.internalReference.toLowerCase() === lower,
				);
				if (site === undefined) {
					return Result.err(
						new ContextUnresolved({ flag: "site", message: `No site named "${wanted}"; sites: ${names.join(", ")}` }),
					);
				}
				return Result.ok(site.id);
			},
		},
	],

	pagination: {
		offsetParam: "offset",
		limitParam: "limit",
		maxLimit: 200,
		page(body) {
			const page = PageSchema.safeParse(body);
			if (!page.success) {
				return Result.err(
					new UnexpectedResponse({
						route: "",
						issues: z.prettifyError(page.error),
						message: "The response is not a page",
					}),
				);
			}
			return Result.ok({ items: page.data.data, total: page.data.totalCount });
		},
	},
};

async function listSites(api: ServiceApi) {
	const response = await api.get("/v1/sites", { limit: "200" });
	if (response.isErr()) {
		return response;
	}
	const sites = SitesSchema.safeParse(response.value);
	if (!sites.success) {
		return Result.err(
			new UnexpectedResponse({
				route: "/v1/sites",
				issues: z.prettifyError(sites.error),
				message: "/v1/sites sent no list of sites",
			}),
		);
	}
	return Result.ok(sites.data.data);
}
