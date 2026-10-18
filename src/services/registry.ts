/**
 * Every service `hl` can drive, by command name.
 */
import type { ServiceDefinition } from "../service.ts";
import { service as homeAssistant } from "./home-assistant/service.ts";
import { service as jellyfin } from "./jellyfin/service.ts";
import { service as immich } from "./immich/service.ts";
import { service as sonarr } from "./sonarr/service.ts";
import { service as radarr } from "./radarr/service.ts";
import { service as lidarr } from "./lidarr/service.ts";
import { service as prowlarr } from "./prowlarr/service.ts";
import { service as proxmox } from "./proxmox/service.ts";
import { service as seerr } from "./seerr/service.ts";
import { service as overseerr } from "./overseerr/service.ts";
import { service as portainer } from "./portainer/service.ts";
import { service as audiobookshelf } from "./audiobookshelf/service.ts";
import { service as kavita } from "./kavita/service.ts";
import { service as komga } from "./komga/service.ts";
import { service as frigate } from "./frigate/service.ts";
import { service as adguard } from "./adguard/service.ts";
import { service as grafana } from "./grafana/service.ts";
import { service as authentik } from "./authentik/service.ts";
import { service as karakeep } from "./karakeep/service.ts";
import { service as speedtestTracker } from "./speedtest-tracker/service.ts";
import { service as truenas } from "./truenas/service.ts";
import { unifi } from "./unifi/service.ts";

/** The services, in the order `hl --help` lists them: infrastructure, network, media, then the rest. */
export const SERVICES: readonly ServiceDefinition[] = [
	proxmox,
	truenas,
	portainer,
	homeAssistant,
	unifi,
	adguard,
	jellyfin,
	immich,
	sonarr,
	radarr,
	lidarr,
	prowlarr,
	seerr,
	overseerr,
	audiobookshelf,
	kavita,
	komga,
	frigate,
	grafana,
	authentik,
	karakeep,
	speedtestTracker,
];
