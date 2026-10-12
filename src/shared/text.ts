import { Temporal } from "temporal-polyfill";
import type { BanAction, NoBanAction, RemovalAction } from "./types";

/**
 * Replace in `textTemplate` and `emptyTemplate`: `user`, `removedNumber`, `list`.
 *
 *  `list` is generated from `entryTemplate`, replaced: `date`, `permalink`, `kind`.
 */
export function formatTextRemoval(
  banContext: { user: string; removals: RemovalAction[] },
  textTemplate: string,
  entryTemplate: string,
  emptyTemplate: string,
) {
  let text = textTemplate;
  if (banContext.removals.length == 0) {
    text = emptyTemplate;
  }
  text = text
    .replaceAll("{user}", banContext.user)
    .replaceAll("{removedNumber}", String(banContext.removals.length));
  if (text.indexOf("{list}") >= 0) {
    text = text.replaceAll(
      "{list}",
      banContext.removals
        .map((e) => formatEntryRemoval(e, entryTemplate))
        .join("\n"),
    );
  }
  return text;
}

function formatEntryBan(entry: BanAction, entryTemplate: string) {
  const date = Temporal.Instant.from(entry.createdAt)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
  return entryTemplate.replaceAll("{date}", date);
}

/**
 * Replace in `textTemplate` and `emptyTemplate`: `user`, `bannedNumber`, `list`.
 *
 *  `list` is generated from `entryTemplate`, replaced: `date`.
 */
export function formatTextBan(
  context: { user: string; bans: BanAction[] },
  textTemplate: string,
  entryTemplate: string,
  emptyTemplate: string,
) {
  const { user, bans } = context;
  let text = textTemplate;
  if (bans.length == 0) {
    text = emptyTemplate;
  }
  text = text
    .replaceAll("{user}", user)
    .replaceAll("{bannedNumber}", String(bans.length));
  if (text.indexOf("{list}") >= 0) {
    text = text.replaceAll(
      "{list}",
      bans.map((e) => formatEntryBan(e, entryTemplate)).join("\n"),
    );
  }
  return text;
}

function formatEntryNoBan(entry: NoBanAction, entryTemplate: string) {
  const date = Temporal.Instant.from(entry.createdAt)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
  const reason =
    entry.from === "unban" ? "ban undone" : "limit reached, not banned";
  return entryTemplate
    .replaceAll("{date}", date)
    .replaceAll("{reason}", reason);
}

/**
 * Replace in `textTemplate` and `emptyTemplate`: `user`, `noBanNumber`, `list`.
 *
 *  `list` is generated from `entryTemplate`, replaced: `date`, `reason`.
 */
export function formatTextNoBan(
  context: { user: string; noBans: NoBanAction[] },
  textTemplate: string,
  entryTemplate: string,
  emptyTemplate: string,
) {
  const { user, noBans } = context;
  let text = noBans.length == 0 ? emptyTemplate : textTemplate;
  text = text
    .replaceAll("{user}", user)
    .replaceAll("{noBanNumber}", String(noBans.length));
  if (text.indexOf("{list}") >= 0) {
    text = text.replaceAll(
      "{list}",
      noBans.map((e) => formatEntryNoBan(e, entryTemplate)).join("\n"),
    );
  }
  return text;
}

function formatEntryRemoval(entry: RemovalAction, entryTemplate: string) {
  const date = Temporal.Instant.from(entry.createdAt)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
  let permalink = `https://www.reddit.com/comments/${entry.target.postId.substring(
    3,
  )}/`;
  let kind = "post";
  if (entry.target.id != entry.target.postId) {
    permalink = `${permalink}_/${entry.target.id.substring(3)}/`;
    kind = "comment";
  }
  return entryTemplate
    .replaceAll("{date}", date)
    .replaceAll("{permalink}", permalink)
    .replaceAll("{kind}", kind);
}

export function formatLastBan(lastBan: number) {
  if (lastBan > 0) {
    return (
      " since last ban on " +
      Temporal.Instant.fromEpochMilliseconds(lastBan)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toString()
    );
  }
  return "";
}

export function formatNotBanned(params: {
  prefix: string;
  body: string;
  user: string;
  lastBan: number;
  nBans: number;
  maxStrikes: number;
  removals: RemovalAction[];
}) {
  const { prefix, body, user, lastBan, maxStrikes, removals, nBans } = params;
  const sinceTxt = formatLastBan(lastBan);

  return `I've not banned ${prefix}u/${user}, but I noticed the limit has been reached:
${removals.length} removals > ${maxStrikes}${sinceTxt}

Number of previous bans: ${nBans}.

Ban message follows.

---

${body}`;
}
