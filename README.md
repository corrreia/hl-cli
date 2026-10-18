# hl

One CLI for the self-hosted services in your homelab. Each service's commands are generated from its OpenAPI spec
with [Forge](https://github.com/cloudflare/forge), the way Cloudflare builds [`cf`](https://github.com/cloudflare/cf).

22 services, each with every API version its project has published (`hl services` lists them):

| Area           | Services                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Infrastructure | Proxmox VE `proxmox`, TrueNAS `truenas`, Portainer CE `portainer`, Home Assistant `home-assistant`                      |
| Network        | UniFi Network `unifi`, AdGuard Home `adguard`                                                                           |
| Media          | Jellyfin `jellyfin`, Immich `immich`, Audiobookshelf `audiobookshelf`, Kavita `kavita`, Komga `komga`                   |
| *arr           | Sonarr `sonarr`, Radarr `radarr`, Lidarr `lidarr`, Prowlarr `prowlarr`, Seerr/Jellyseerr `seerr`, Overseerr `overseerr` |
| Other          | Frigate `frigate`, Grafana `grafana`, authentik `authentik`, Karakeep `karakeep`, Speedtest Tracker `speedtest-tracker` |

What `--api-key` takes depends on the service: an API key for most, `user:password` for AdGuard Home, a service account
token for Grafana, an API token for authentik. Frigate's unauthenticated port needs none. Karakeep and Speedtest Tracker
can't say their version, so pin one with `--pin-version` (otherwise the newest is used).

```sh
npm i -g @corrreia/hl
hl --help
```

Or from a clone:

```sh
pnpm install
pnpm build          # forge plugin → catalogues → dist/
./bin/hl --help     # or, without building: pnpm dev --help
```

## Instances

A service can have several servers. Add each with a name; the first is the default.

```sh
hl instances add unifi home  --url https://192.168.1.1 --insecure          # asks for the key
hl instances add unifi cabin --url https://10.0.0.1 --api-key-cmd "pass show homelab/unifi-cabin"
hl instances list
hl instances use unifi cabin       # change the default
hl instances refresh               # ask every server for its version again
```

`--insecure` accepts a self-signed certificate, as most consoles have.

### Keys

| How                                                                   | What hl keeps                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing (hl asks, without echoing), `--api-key-stdin`, or `--api-key` | The key, in the system keyring: the Secret Service (GNOME Keyring, KWallet, KeePassXC) through `secret-tool`, or the macOS Keychain. The config file has only a reference. |
| `--api-key-cmd "<command>"`                                           | The command, run each time a key is needed: `pass show …`, `op read …`, `bw get password …`                                                                                |
| `--api-key-env NAME`                                                  | The variable's name, read each time                                                                                                                                        |
| `--store-in-config`                                                   | The key, in the config file (mode 0600), for machines without a keyring                                                                                                    |

Without a keyring, hl won't fall back to the config file on its own; it says so and suggests the others. `--api-key`
works but stays in your shell history.
The config is `~/.config/hl/config.json` (`$HL_CONFIG` overrides it).

## Commands

```sh
hl unifi devices list                         # the default instance, its default (or only) site
hl unifi@cabin devices list --site guest      # another instance, a site by name or reference
hl unifi devices list --all -o table          # every instance, one table with an INSTANCE column
hl unifi clients list --all-pages             # every page
hl unifi vouchers create --name Guests --time-limit-minutes 60 --count 5
hl unifi firewall policies create --body @policy.json
hl unifi devices remove <device-id>           # asks first; --yes to skip
hl unifi wifi list --dry-run                  # print the request instead
```

Output is JSON (indented on a terminal, compact when piped); `-o table` prints a list's scalar columns, and
`--columns name,state` picks them.

## Versions

`hl` asks each server which version it runs, when it is added and again once a day, and builds that instance's
commands from the newest bundled spec that isn't newer. `hl unifi@cabin --help` shows the commands cabin's version
has. With `--all`, every instance runs the command as its own version has it, and one without it is skipped.

## How it's built

```
specs/<service>/<version>.json
  └─ overlay (src/services/<service>/overlay.ts): names every operation
       └─ forge --target wasm://generator/hl.wasm   (plugin: generator/plugin.ts)
            └─ src/services/<service>/_generated/<version>.ts   (a command catalogue)
```

The runtime builds yargs commands from the catalogue of the instance a run is for. A service's hand-written definition
(`src/services/<service>/service.ts`) says what the spec doesn't: where the API lives, how to authenticate, how to ask
for the version, context parameters such as UniFi's `--site`, and paging.

Each service's `spec.ts` says where its specs are published (release tags in its git repository, or a page that lists
versions) and how to name its operations: by hand (UniFi), or derived from each operation's tag and operationId, or its
method and path, with overrides. A service's catalogues share most commands, so they're kept as one module per service
with each distinct command once.

### Services without a usable spec

Some projects don't publish an OpenAPI document, so `hl` makes one; the code is in this repository and runs as part of
`pnpm fetch-specs`:

| Service          | What's published                                                                                | How it becomes OpenAPI 3                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proxmox VE       | The API viewer's schema (`apidoc.js`), in each release's `pve-docs` Debian package              | `generator/debian.ts` downloads it from Proxmox's repository, verified against its signed `InRelease` (keys over HTTPS) and the package hashes; `generator/convert/proxmox.ts` converts it                                                                                                                                                                                                                                             |
| TrueNAS (25.10+) | A JSON-RPC 2.0 API over WebSocket, documented at api.truenas.com from its middleware's own dump | `generator/truenas-dump.ts` runs `middlewared --dump-api` in TrueNAS's middleware image (Docker, offline, source read-only); `generator/convert/truenas.ts` makes each method a `POST /<method>` with its parameters as body fields; `src/jsonrpc.ts` calls them over WebSocket, on the exact API version of the commands (the `.0` of each line: 25.10, 27.0, 28.0), or on `/api/current` for a server older than all of them (25.04) |
| Home Assistant   | REST API documentation only                                                                     | `src/services/home-assistant/openapi.ts`, written by hand from the docs                                                                                                                                                                                                                                                                                                                                                                |
| Portainer CE     | Split multi-file specs (newer) and Swagger 2 (older)                                            | `generator/load-spec.ts` bundles the files' `$ref`s and converts Swagger 2; any other service's Swagger 2 or split spec loads the same way                                                                                                                                                                                                                                                                                             |

Fetching Proxmox needs `gpgv`, `ar` and `tar`; fetching TrueNAS needs Docker (its image is 13 GB).

### New versions

`pnpm fetch-specs` downloads each service's newest published versions not in `specs/` yet, and keeps only those whose
API differs from the version before (the rest are listed in `specs/<id>/skipped.txt`). A server between two kept
versions uses the older one's commands, which are its API. Then `pnpm generate`.

### Adding a service

1. `src/services/<id>/spec.ts`: where its specs are, and how to name operations (see `generator/spec-config.ts`)
2. `src/services/<id>/service.ts`: `defineService` with its base path, auth, and version route
3. `pnpm fetch-specs <id> && pnpm generate <id>`, then add it to `src/services/registry.ts` and to the version probes in
   `src/services/services.test.ts`.

## Development

```sh
pnpm generate   # build the plugin and the catalogues (not committed); run it first
pnpm test       # tests run hl against fake servers on localhost
pnpm check      # types, lint, format
```

CI checks every push. A weekly workflow runs `pnpm fetch-specs` and opens a pull request with any new versions. To
release, bump `version` in `package.json` and push a matching tag (`v0.2.0`); the release workflow publishes to npm
with provenance.
