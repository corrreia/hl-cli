# hl — homelab CLI — design

## Intent

One command, `hl`, that drives the self-hosted services in a homelab through
their own HTTP APIs. Each service's OpenAPI spec is turned into commands at
build time with Cloudflare's Forge, the same way Cloudflare builds `cf`.
UniFi Network is the first service; Jellyfin, Proxmox and others follow.

## Goals

- A single binary: `hl <service>[@<instance>] <group…> <command> [args]`.
- **Several instances per service.** A homelab can have two Jellyfin servers or
  two Proxmox nodes. Each instance has a name, URL, credentials and TLS
  settings; one per service is the default.
- **Version aware.** `hl` asks each instance which version it runs, saves it,
  and uses the command set generated from the newest bundled spec that is not
  newer than the server. Help (`hl unifi@cabin --help`) follows the instance.
- `--all` runs a command on every instance of a service, each with its own
  command set; an instance whose version lacks the command is skipped with a
  note.
- LAN only: instances are reached directly at their URL. Self-signed
  certificates are common, so each instance can skip TLS verification.
- JSON output by default (pretty on a terminal, compact when piped), with an
  optional table view.

## Non-goals

- Cloud relays (UniFi's `api.ui.com` connector) — LAN only.
- Loading arbitrary specs at runtime. Services ship in `hl` releases.
- OAuth flows, keyrings and telemetry from `cf`.

## Anti-goals

- Commands that silently hit the wrong server: the instance must be obvious,
  and `--all` output labels every row with its instance.
- Destructive calls without confirmation (`DELETE`s ask unless `--yes`).

## How it is built

```
specs/<service>/<version>.json ──overlay (services/<id>/overlay.ts)──▶ forge
    --target wasm://generator/hl.wasm ──▶ src/services/<id>/_generated/<version>.ts
```

- **Forge** (`@cloudflare/forge`, pinned to the same pkg.pr.new commit as cf)
  parses the spec and hands the model to a plugin.
- **The overlay** names every operation through Forge's extensions:
  `x-fern-sdk-group-name` (dot-separated groups), `x-fern-sdk-method-name`,
  and `x-forge-require-confirmation`. Generation fails if an operation is not
  named, so a new spec version cannot add unnamed commands. The same overlay
  applies to every version of a service, which keeps command names stable.
- **The plugin** (`generator/plugin.ts`, compiled to WASM) writes one typed
  catalogue module per spec version: every command's group path, HTTP method,
  route, parameters, body fields and confirmation. Unlike `cf`, which emits
  one yargs module per operation, `hl` builds yargs commands from the
  catalogue at runtime. With several versions of each service, the version
  to load is only known once the instance is known, and a catalogue is the
  simplest thing to choose between.
- **Service definitions** (`src/services/<id>/service.ts`, hand-written) say
  what a spec cannot: the base path, how to authenticate, how to ask for the
  version, which path parameters are context (UniFi's `siteId` → `--site`),
  and how pagination works.

## Runtime

- Config lives at `$XDG_CONFIG_HOME/hl/config.json` (mode 0600), parsed with
  Zod at startup. API keys are stored there or read from an environment
  variable named per instance.
- `hl instances add|list|remove|use|refresh` manages instances. `add` probes
  the server and saves its version; the saved version is re-probed when it is
  older than a day or by `refresh`.
- Path parameters become positional arguments, query parameters become flags,
  JSON bodies come from `--body` (JSON, `@file` or `@-` for stdin), and a
  body's top-level scalar fields also get their own flags.
- Context parameters: `--site` takes a site id or name; without it, the
  instance's default site is used, or the only site if there is one.
- Expected failures (HTTP errors, unreachable servers, TLS failures, bad
  config) are typed `better-result` errors, rendered once at the entry point.

## Decided by the user

- One `hl` binary for every service.
- Multiple instances per service.
- Automatic version detection, using the right command set per instance.
- LAN only.
- UniFi Network (10.6.106) first.

## Builder's calls

- The UniFi service is named `unifi`.
- Command names for UniFi (see `services/unifi/overlay.ts`).
- Catalogue-driven runtime instead of per-operation generated modules.
- Node ≥ 22, TypeScript, yargs, Zod, better-result, undici, Vite+.
