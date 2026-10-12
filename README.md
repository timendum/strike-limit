# Strike Limit

A moderation app for Reddit that keeps track of how often a user's content is removed and automatically bans users who cross a strike limit.

## What it does

- Counts each time a user is notified of a content (post or comment) removal via "Add removal reason" as a strike.
- Removes the strike again if the content is later approved.
- Bans a user once they reach the configured number of strikes.
- Supports escalating rules: the second ban can use a higher strike limit and a longer duration than the first, and so on.
- Can be set to only notify the mod team by ModMail instead of banning.
- Tracks unbans as "ban undone" in a user's history (if the ban last less than 24 hours.)
- Sends the user a customizable ban message listing the removed content.

## Settings

- **Number of strikes for a ban** — How many removals trigger a ban. Enter several values separated by `;` to escalate on repeat offenders (first value for the first ban, second value for the second, and so on).
- **Ban duration (days)** — How long a ban lasts. `0` means permanent. Multiple values separated by `;` escalate the same way as strikes.
- **How many days are considered** — Only removals within this window count toward the limit. `0` keeps the maximum window. Strikes expire automatically after 365 days.
- **Don't ban, just notify** — When on, no bans are issued; the mod team is notified by ModMail instead.
- **Don't ban Approved users** — When on, approved users are skipped and the mod team is notified by ModMail instead.
- **Ban message** — The message sent to a banned user. Placeholders: `{list}`, `{user}`, `{removedNumber}`.
- **Ban list entry** — The format for each removed item shown in `{list}`. Placeholders: `{kind}`, `{permalink}`, `{date}`.

## Checking a user

Send an internal ModMail with a subject containing both `strike` and `query` plus the username (for example, `strike query u/example`). The app replies with the recorded removals for that user.
