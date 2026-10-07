# AGENTS.md

A Reddit Developer Platform (Devvit Web) app. It is server-only (no client/webview): it reacts to Reddit mod-action and mod-mail triggers, records content removals per user in Redis, and auto-bans users who cross a configurable strike threshold.

## Stack

- **Runtime**: Devvit Web server, Node `>=22.6.0`, ESM (`"type": "module"`).
- **HTTP**: Hono. The Devvit server is started via `serve` from `@devvit/web/server` in `src/server/index.ts`.
- **Devvit APIs**: `@devvit/web/server` provides `reddit`, `redis`, `settings`, `createServer`, `getServerPort`. Trigger/settings request/response types come from `@devvit/web/shared`.
- **Dates**: `temporal-polyfill` (`Temporal`). All stored timestamps are epoch **milliseconds**.
- **Build**: Vite (`vite build`) → `dist/server/index.cjs` (entry declared in `devvit.json`).
- **Checks**: `npm run checks` = `eslint src` + `tsc --noEmit`. TypeScript is `strict`.

## Layout

```
devvit.json              App manifest: permissions, triggers, settings schema, server entry.
src/server/index.ts      Hono app wiring. Mounts /internal/{settings,triggers}.
src/server/routes/
  triggers.ts            Trigger endpoints: app-install, app-upgrade, mod-action, mod-mail.
  settings.ts            Settings validation endpoints.
src/server/core/
  strikes.ts             Core domain logic: store removals/bans, evaluate ban, modmail query reply.
src/shared/
  types.ts               RemovalAction, BanAction + runtime type guards.
  config.ts              Reads/normalizes app settings; getNForBan escalation helper.
  text.ts                Template formatting for ban/removal messages.
```

## Request flow

All endpoints are mounted under `/internal` and are invoked by Devvit based on `devvit.json`:

- `triggers.onModAction` → `POST /internal/triggers/mod-action` — the main entry point.
- `triggers.onModMail` → `POST /internal/triggers/mod-mail` — user strike queries.
- `triggers.onAppInstall` / `onAppUpgrade` → log only.
- `settings.*.validationEndpoint` → `POST /internal/settings/<key>` — validate settings input.

Each trigger handler returns a `TriggerResponse` with `status: "success" | "skipped"`.

### mod-action

`mod-action` runs two handlers in parallel and reports success if either handled the event:

- `handleAddRemovalReason`: only acts on `action === "addremovalreason"`. Builds a `RemovalAction` from `targetComment` or `targetPost`, validates with `isRemovalAction`, then `storeRemovalAction`.
- `handleBan`: only acts on `action === "banuser"`. Builds a `BanAction`, validates with `isBanAction`, then `storeBan`. Note: this records every ban, including bans issued by this app, which drives escalation.

### mod-mail

`handleModMailQuery` ignores auto-generated mail, non-`internal` conversations, and non-`new` state. Otherwise calls `replyModMailQuery`, which parses the subject (must contain both `strike` and `query`), extracts a username, and replies with that user's recorded removals. Guards against replying to its own mail via `reddit.getAppUser()`.

## Redis data model

Two sorted sets (ZSETs) per user, keyed by username:

- `user:{username}:removal` — score = `target.createdAt` (epoch ms); member = JSON `RemovalAction`.
- `user:{username}:ban` — score = ban `createdAt` as epoch ms; member = JSON `BanAction`.

Conventions:

- **Dedup**: `storeRemovalAction` queries `zRange(key, score, score, {by:"score"})` and skips if a member with the same `target.id` already exists.
- **TTL**: `redis.expire(key, 366*24*60*60)` is reset on every write (≈366 days).
- Reads use `zRange(key, since, "+inf", {by:"score"})`; members are JSON-parsed then filtered through the type guards (`isRemovalAction` / `isBanAction`) to drop malformed entries.

## Ban evaluation (`maybeBanUser`)

Called after each stored removal. Logic:

1. Load strike config and ban history (`getBans` → `{ nBans, lastBan }`, where `nBans` is a lifetime `zCard`).
2. Compute `since = max(lastBan, now - spanDays)` when `spanDays > 0`; strikes before `since` are ignored.
3. Load removals since `since`. If `includeReddit` is false, keep only `modType === "mod"`.
4. `maxStrikes = getNForBan(nBans, strikesBan)`. If `removals.length < maxStrikes`, return (no ban).
5. Otherwise ban: duration = `getNForBan(nBans, banDuration)` (`0` → permanent, passed as `undefined`); ban message built by `formatTextRemoval`.
6. Modes: `noBan` → ModMail notify only; `ignoreApproved` → check `reddit.getApprovedUsers`; else `reddit.banUser`.

`getNForBan(nBans, config)` returns `config[nBans]` or the last element — this is the per-repeat-offense escalation.

## Settings

Declared in `devvit.json` under `settings.subreddit`. Read and normalized in `config.ts`:

- `strikes-ban` (string, `;`-separated ints) → `strikesBan: number[]`.
- `ban-duration` (string, `;`-separated ints, days, 0 = permanent) → `banDuration: number[]`.
- `span-days` (number, 0 = max) → `spanDays`.
- `include-reddit`, `no-ban`, `ignore-approved` (booleans).
- `ban-text`, `ban-entry` (templates; placeholders handled in `text.ts`: `{user}`, `{removedNumber}`, `{list}`, and per-entry `{date}`, `{permalink}`, `{kind}`).

`settings.ts` validates `strikes-ban` (each `;` part a positive int ≥1) and `ban-duration` (each ≥0).

## Conventions for edits

- Keep timestamps in epoch **milliseconds** for Redis scores; convert ISO strings via `Temporal.Instant.from(...).epochMilliseconds`.
- Validate any object parsed from Redis or a trigger payload through the guards in `types.ts` before use.
- New settings must be added in **both** `devvit.json` (schema) and `config.ts` (read + default), and get a `validationEndpoint` handler in `settings.ts` if `devvit.json` references one.
- Trigger handlers must return a `TriggerResponse` (`success`/`skipped`) and should be side-effect-idempotent where possible (removal dedup already assumes repeated deliveries).
- Run `npm run checks` before considering a change done.
