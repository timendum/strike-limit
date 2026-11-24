# AGENTS.md

A Reddit Developer Platform (Devvit Web) app. It is server-only (no client/webview): it reacts to Reddit mod-action and mod-mail triggers, records content removals per user in Redis, and auto-bans users who cross a configurable strike threshold.

## Stack

- **Runtime**: Devvit Web server, Node `>=22.6.0`, ESM (`"type": "module"`).
- **HTTP**: Hono. The Devvit server is started via `serve` from `@devvit/web/server` in `src/server/index.ts`.
- **Devvit APIs**: `@devvit/web/server` provides `reddit`, `redis`, `settings`, `createServer`, `getServerPort`. Trigger/settings request/response types come from `@devvit/web/shared`.
- **Dates**: `temporal-polyfill` (`Temporal`). All stored timestamps are epoch **milliseconds**.
- **Build**: Vite (`vite build`) → `dist/server/index.cjs` (entry declared in `devvit.json`).
- **Checks**: `npm run checks` = `oxlint src test` + `oxfmt --check src test` + `tsc --noEmit`. TypeScript is `strict`.

## Layout

```
devvit.json              App manifest: permissions, triggers, settings schema, server entry.
src/server/index.ts      Hono app wiring. Mounts /internal/{settings,triggers}.
src/server/routes/
  triggers.ts            Trigger endpoints: app-install, app-upgrade, mod-action, mod-mail.
  settings.ts            Settings validation endpoints.
src/server/core/
  store.ts               Redis persistence: removals, bans, noBan events, `modmail:{id}` ban requests.
  evaluate.ts            evaluateStrikes, maybeBanUser (notify or ban decision), notifyNotBanned.
  modmail.ts             Modmail handlers: user strike query reply, "ban" reply to notifications.
src/shared/
  types.ts               RemovalAction, BanAction, NoBanAction + runtime type guards.
  config.ts              Reads/normalizes app settings; getNForBan escalation helper.
  text.ts                Template formatting for ban/removal messages.
```

## Request flow

All endpoints are mounted under `/internal` and are invoked by Devvit based on `devvit.json`:

- `triggers.onModAction` → `POST /internal/triggers/mod-action` — the main entry point.
- `triggers.onModMail` → `POST /internal/triggers/mod-mail` — user strike queries and "ban" replies to notifications.
- `triggers.onAppInstall` / `onAppUpgrade` → log only.
- `settings.*.validationEndpoint` → `POST /internal/settings/<key>` — validate settings input.

Each trigger handler returns a `TriggerResponse` with `status: "success" | "skipped"`.

### mod-action

`mod-action` runs three handlers in parallel and reports success if any handled the event:

- `handleAddRemovalReason`: only acts on `action === "addremovalreason"`. Builds a `RemovalAction` from `targetComment` or `targetPost`, validates with `isRemovalAction`, then `storeRemovalAction`.
- `handleApprove`: only acts on `action === "approvecomment" | "approvelink"`. Builds the same `RemovalAction` shape (keyed by `target.id`), validates with `isRemovalAction`, then `removeRemovalAction` — undoing a prior strike when content is approved.
- `handleBan`: only acts on `action === "banuser"`. Builds a `BanAction`, validates with `isBanAction`, then `storeBan`. Note: this records every ban, including bans issued by this app, which drives escalation.

### mod-mail

`handleModMailQuery` ignores auto-generated mail, non-`internal` conversations, and non-`new` state. Otherwise calls `replyModMailQuery`, which parses the subject (must contain both `strike` and `query`), extracts a username, and replies with that user's recorded removals. Guards against replying to its own mail via `reddit.getAppUser()`.

`handleBanReply` runs in parallel with `handleModMailQuery` (route returns `success` if either handled the event). It ignores auto-generated mail and non-`internal` conversations but does **not** filter on state (replies arrive in any state). It calls `replyBanFromModMail`:

1. Read the `modmail:{conversationId}` hash (`parseModMailBanRequest`). No mapping, malformed, or `handled` → ignore. Only conversations the app created for a notify-only outcome have a mapping; older conversations are not actionable.
2. Fetch the conversation, find the message by `messageId` (ids are normalized by stripping `ModmailConversation_` / `ModmailMessage_`; falls back to the latest message). Body = `bodyMarkdown ?? body`, HTML tags stripped, trimmed, lower-cased; must equal `ban`.
3. Author must have a name, not be hidden/deleted, not be the app account, and be returned by `reddit.getModerators({username})` with `modPermissions` containing `access` (Manage Users) or `all`. Lookup errors fail closed. There is no bot flag in the API; other bots are accepted only if they are moderators with that permission.
4. Claim with `hSetNX(key, "lock", "1")` so a repeated delivery cannot ban twice.
5. User already banned per `reddit.getBannedUsers` → set `handled`, reply "already banned".
6. Recompute with `evaluateStrikes(user, notifiedAt)` (same window logic as `maybeBanUser`, but `:noBan` entries scored at or after the notification are ignored, otherwise the notification itself would hide all removals). Below the limit → reply with an explanation, release the lock, keep the mapping pending.
7. Ban with duration `getNForBan(nBans, banDuration)` and the `formatTextRemoval` ban message; set `handled` and reply "user banned" with the actual duration. On error set `handled` and reply with the error.

The app's own messages are skipped by author, and its replies never equal `ban`, so there is no loop.

## Redis data model

Three sorted sets (ZSETs) per user, keyed by username, plus one hash per notification conversation:

- `user:{username}:removal` — score = `target.createdAt` (epoch ms); member = JSON `RemovalAction`.
- `user:{username}:ban` — score = ban `createdAt` as epoch ms; member = JSON `BanAction`.
- `user:{username}:noBan` — score = `createdAt` as epoch ms; member = JSON `NoBanAction`. When the user crossed the threshold but was **not** banned (notify-only / approved / moderator paths). Advances the counting window but not the escalation tier.
- `modmail:{conversationId}` — hash written by `storeBanRequest` when a `noBan`-setting or approved-user notification is sent (not for the moderator path). Fields: `user`, `duration` (days shown in the notification, 0 = permanent), `notifiedAt` (epoch ms, same instant as the `:noBan` entry), optional `lock` (`"1"` while a reply is processed) and `handled` (`"1"` once banned, already banned, or ban failed). TTL ≈366 days, set at creation.

Conventions:

- **Dedup**: `storeRemovalAction` queries `zRange(key, score, score, {by:"score"})` and skips if a member with the same `target.id` already exists.
- **Approval removal**: `removeRemovalAction` queries the same score window, filters by `target.id`, and `zRem`s the **original stored member string**. No-op if none found. Does **not** call `maybeBanUser` (approvals only reduce strikes) and does **not** extend TTL (no need).
- **TTL**: `redis.expire` resets all three user keys on every write/add (≈366 days); the removal path above intentionally skips it.
- Reads use `zRange(key, since, "+inf", {by:"score"})`; members are JSON-parsed then filtered through the type guards (`isRemovalAction` / `isBanAction` / `isNoBanAction`) to drop malformed entries.

## Ban evaluation (`maybeBanUser`)

Called after each stored removal. Logic:

1. (`evaluateStrikes`) Load strike config and history via `getUserBans` → `{ nBans, lastBan }`. `nBans` = `zCard` of the `:ban` set only (real bans; `:noBan` is **excluded**). `lastBan` = latest score across **both** `:ban` and `:noBan`.
2. Compute `since = max(lastBan, now - spanDays)` when `spanDays > 0`; strikes before `since` are ignored.
3. Load removals since `since`. If `includeReddit` is false, keep only `modType === "mod"`.
4. `maxStrikes = getNForBan(nBans, strikesBan)`. If `removals.length < maxStrikes`, return (no ban).
5. Otherwise, resolve the outcome. Non-ban paths each send an internal ModMail (`formatNotBanned`), call `storeNoBan`, and return:
   - `noBan` setting on → notify only.
   - `ignoreApproved` on and user in `reddit.getApprovedUsers` → notify only.
   - user in `reddit.getModerators` → notify only.
   The `noBan` and approved paths go through `notifyNotBanned`: the ModMail includes a "reply `ban`" line with the duration `getNForBan(nBans, banDuration)` and a `modmail:{conversationId}` mapping is stored. The moderator path has neither.
   Otherwise ban: duration = `getNForBan(nBans, banDuration)` (`0` → permanent, passed as `undefined`); message built by `formatTextRemoval`; `reddit.banUser`. The `banuser` ModAction this issues is later recorded via `storeBan`, incrementing `nBans`.

`getNForBan(nBans, config)` returns `config[nBans]` or the last element — the per-repeat-offense escalation.

**Window vs escalation (intentional):** a `storeNoBan` write advances `lastBan`, so the next evaluation's `since` moves forward and removal counting restarts — this throttles repeat ModMail. But because `nBans` ignores the `:noBan` set, `maxStrikes` stays at the same tier. Net: notify-only outcomes reset the counting window but never escalate; only a real ban advances the tier.

## Settings

Declared in `devvit.json` under `settings.subreddit`. Read and normalized in `config.ts`:

- `strikes-ban` (string, `;`-separated ints) → `strikesBan: number[]`.
- `ban-duration` (string, `;`-separated ints, days, 0 = permanent) → `banDuration: number[]`.
- `span-days` (number, 0 = max) → `spanDays`.
- `include-reddit`, `do-ban`, `ignore-approved` (booleans).
- `ban-text`, `ban-entry` (templates; placeholders handled in `text.ts`: `{user}`, `{removedNumber}`, `{list}`, and per-entry `{date}`, `{permalink}`, `{kind}`).

`settings.ts` validates `strikes-ban` (each `;` part a positive int ≥1) and `ban-duration` (each ≥0).

## Conventions for edits

- Keep timestamps in epoch **milliseconds** for Redis scores; convert ISO strings via `Temporal.Instant.from(...).epochMilliseconds`.
- Validate any object parsed from Redis or a trigger payload through the guards in `types.ts` before use.
- New settings must be added in **both** `devvit.json` (schema) and `config.ts` (read + default), and get a `validationEndpoint` handler in `settings.ts` if `devvit.json` references one.
- Trigger handlers must return a `TriggerResponse` (`success`/`skipped`) and should be side-effect-idempotent where possible (removal dedup already assumes repeated deliveries).
- Run `npm run checks` before considering a change done.
