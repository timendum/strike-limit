import {
  SettingsValidationRequest,
  SettingsValidationResponse,
} from "@devvit/web/shared";
import { Hono } from "hono";

export const settings = new Hono();

function isPositiveInteger(str: string, min = 1) {
  const n = Number(str);
  return str.trim() !== "" && Number.isInteger(n) && n >= min;
}

settings.post("/strikes-ban", async (c) => {
  const { value } = await c.req.json<SettingsValidationRequest<string>>();

  if (!value) {
    return c.json<SettingsValidationResponse>({
      success: false,
      error: "Please enter at least one number",
    });
  }
  const strikes = value.split(";");

  for (const strike of strikes) {
    if (!isPositiveInteger(strike))
      return c.json<SettingsValidationResponse>({
        success: false,
        error: "Invalid number of strike: " + strike,
      });
  }

  return c.json<SettingsValidationResponse>({ success: true });
});

settings.post("/ban-duration", async (c) => {
  const { value } = await c.req.json<SettingsValidationRequest<string>>();

  if (!value) {
    return c.json<SettingsValidationResponse>({
      success: false,
      error: "Please enter at least one number",
    });
  }
  const durations = value.split(";");

  for (const duration of durations) {
    if (!isPositiveInteger(duration, 0))
      return c.json<SettingsValidationResponse>({
        success: false,
        error: "Invalid ban duration: " + duration,
      });
  }

  return c.json<SettingsValidationResponse>({ success: true });
});

settings.post("/span-days", async (c) => {
  const { value } = await c.req.json<SettingsValidationRequest<number>>();

  if (value === undefined || value < 0 || value > 365) {
    return c.json<SettingsValidationResponse>({
      success: false,
      error: "Please enter a number between 0 and 365",
    });
  }

  return c.json<SettingsValidationResponse>({ success: true });
});
