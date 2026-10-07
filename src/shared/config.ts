import { settings } from "@devvit/web/server";

export async function getStrikeConfig() {
  let [strikesBanSrt, spanDays, includeReddit] = await Promise.all([
    settings.get<string>("strikes-ban"),
    settings.get<number>("span-days"),
    settings.get<boolean>("include-reddit"),
  ]);
  // default, to avoid undefined
  strikesBanSrt = strikesBanSrt || "3";
  spanDays = spanDays || 0;
  includeReddit = includeReddit === undefined ? false : includeReddit;
  const strikesBan = strikesBanSrt
    .split(";")
    .map((d) => Number(d))
    .filter(Number.isFinite);
  return {
    strikesBan,
    spanDays,
    includeReddit,
  };
}

export async function getBanConfig() {
  let [ignoreApproved, noBan, banText, banEntry, banDurationStr] =
    await Promise.all([
      settings.get<boolean>("ignore-approved"),
      settings.get<boolean>("no-ban"),
      settings.get<string>("ban-text"),
      settings.get<string>("ban-entry"),
      settings.get<string>("ban-duration"),
    ]);
  banDurationStr = banDurationStr || "30";
  ignoreApproved = ignoreApproved === undefined ? false : ignoreApproved;
  noBan = noBan === undefined ? false : noBan;
  banText = banText || "";
  banEntry = banEntry || "";
  const banDuration = banDurationStr
    .split(";")
    .map((d) => Number(d))
    .filter(Number.isFinite);
  return {
    noBan,
    ignoreApproved,
    banText,
    banEntry,
    banDuration,
  };
}
/** Returns config[nBans] or last config */
export function getNForBan(nBans: number, config: number[]) {
  if (nBans < config.length) {
    return config[nBans];
  }
  return config[config.length - 1];
}
