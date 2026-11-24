# Strike Limit
A moderation app for Reddit that counts each time a user's content is removed with an "Add removal reason" mod action and notifies the mod team by ModMail when a user reaches a strike limit. A moderator replies `ban` to the notification to ban the user. The app can also be set to ban directly at the limit.

## What it does

- Counts each time a user is notified of a content (post or comment) removal via "Add removal reason" as a strike.
- Removes the strike again if the content is later approved.
- Sends the mod team an internal ModMail once a user reaches the configured number of strikes. The ModMail states the ban duration that would apply.
- Bans the user when a moderator replies `ban` to that ModMail.
- Sends the banned user a customizable ban message listing the removed content.

### Features

- Supports escalating rules: the second ban can use a different strike limit and a longer duration than the first, and so on.
- Optionally bans directly at the strike limit, without waiting for a moderator (see below).
- Notifications do not escalate the ban configuration. Only real bans do.
- Notifies the mod team instead of banning approved users, if enabled.
- Tracks "ban undone" in a user's history (if the ban lasts less than 24 hours.)

## Banning from a notification

When a user reaches the limit, by default, the app sends an internal ModMail to the mod team. It says which ban duration would apply.
A moderator with the Manage Users permission (or full permissions) can reply with just `ban` (any case) to ban the user. Before banning, the app recounts the user's current strikes. It replies with the result: "user banned" with the duration applied, "already banned", not banned because the user is now below the limit, or the error.
After a notification, strikes counted before it are not counted again. The next notification needs new removals to reach the limit.
Notifications about moderators cannot be answered this way.

## Banning at the strike limit (optional)

Turn on **Ban instead of notify** to skip the notification and ban the user as soon as they reach the limit. The ban message is sent to the user and no ModMail is sent to the mod team. Approved users (if **Don't ban Approved users** is on) and moderators are still only notified.

## Settings

- **Number of strikes for a ban** — How many removals trigger a notification. Enter several values separated by `;` to escalate on repeat offenders (first value for the first ban, second value for the second, and so on).
- **Ban duration (days)** — How long a ban lasts. `0` means permanent. Multiple values separated by `;` escalate the same way as strikes.
- **How many days are considered** — Only removals within this window count toward the limit. `0` keeps the maximum window. Strikes expire automatically after 365 days.
- **Ban instead of notify** — Off by default. When on, the user is banned at the strike limit and the mod team is not notified.
- **Don't ban Approved users** — When on, approved users are never banned automatically. The mod team is notified and can reply `ban` (useful only if previous setting is enabled).
- **Ban message** — The message sent to a banned user. Placeholders: `{list}`, `{user}`, `{removedNumber}`.
- **Ban list entry** — The format for each removed item shown in `{list}`. Placeholders: `{kind}`, `{permalink}`, `{date}`.

## Checking a user

Send an internal [ModMail](https://www.reddit.com/mail/create) with a subject
containing both `strike` and `query` plus the username (for example, `strike query u/example`).
The app replies with the recorded removals for that user.
