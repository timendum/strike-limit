import { createServer, getServerPort } from "@devvit/web/server";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { settings } from "./routes/settings";
// import { api } from "./routes/api";
// import { forms } from "./routes/forms";
// import { menu } from "./routes/menu";
import { triggers } from "./routes/triggers";

const app = new Hono();
const internal = new Hono();

// internal.route("/menu", menu);
// internal.route("/forms", forms);
internal.route("/settings", settings);
internal.route("/triggers", triggers);
// app.route("/api", api);

app.route("/internal", internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
