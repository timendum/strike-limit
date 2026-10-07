import { Temporal } from "temporal-polyfill";
import type { RemovalAction } from "./types";

type UserContext = {
  user: string;
  removals: RemovalAction[];
};

/** Replace in `textTemplate`: `user`, `removedNumber`, `list`.
 *
 *  `list` is generated from `entryTemplate`, replaced: `date`, `permalink`, `kind`.
 */
export function formatTextRemoval(
  banContext: UserContext,
  textTemplate: string,
  entryTemplate: string
) {
  let text = textTemplate;
  text = text
    .replaceAll("{user}", banContext.user)
    .replaceAll("{removedNumber}", String(banContext.removals.length));
  if (text.indexOf("{list}") >= 0) {
    text = text.replaceAll(
      "{list}",
      banContext.removals
        .map((e) => formatEntryRemoval(e, entryTemplate))
        .join("\n")
    );
  }
  return text;
}

function formatEntryRemoval(entry: RemovalAction, entryTemplate: string) {
  const date = Temporal.Instant.from(entry.createdAt)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
  let permalink = `https://www.reddit.com/comments/${entry.target.postId}/`;
  let kind = "post";
  if (entry.target.id != entry.target.postId) {
    permalink = `${permalink}_/${entry.target.id}/`;
    kind = "comment";
  }
  return entryTemplate
    .replaceAll("{date}", date)
    .replaceAll("{permalink}", permalink)
    .replaceAll("{kind}", kind);
}
