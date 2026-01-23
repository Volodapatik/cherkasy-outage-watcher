import path from "path";
import express from "express";
import { state, getChannelUrl, debugParse } from "./watcher";
import { formatDateTimeUA } from "./time";
import { addSubscription, getPublicKey, isPushConfigured, removeSubscription, sendTestPush } from "./push";

const PORT = Number(process.env.PORT || 3000);

export function startServer() {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));
  app.use(express.static(path.join(process.cwd(), "public")));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.render("index", {
      latest: state.latest,
      sourceUrl: getChannelUrl(),
      formatDateTimeUA
    });
  });

  app.get("/history", (_req, res) => {
    res.render("history", {
      history: [...state.history].reverse(),
      formatDateTimeUA
    });
  });

  app.get("/api/latest", (_req, res) => {
    res.json(state.latest);
  });

  app.get("/api/history", (_req, res) => {
    res.json(state.history);
  });

  app.get("/api/push/public-key", (_req, res) => {
    const publicKey = getPublicKey();
    if (!publicKey) {
      res.status(503).json({ error: "Push is not configured" });
      return;
    }
    res.json({ publicKey });
  });

  app.post("/api/push/subscribe", async (req, res) => {
    if (!isPushConfigured()) {
      res.status(503).json({ error: "Push is not configured" });
      return;
    }
    const subscription = req.body;
    if (!subscription?.endpoint) {
      res.status(400).json({ error: "Invalid subscription" });
      return;
    }
    await addSubscription(subscription);
    res.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    const subscription = typeof req.body === "string" ? { endpoint: req.body } : req.body;
    if (!subscription?.endpoint) {
      res.status(400).json({ error: "Invalid subscription" });
      return;
    }
    await removeSubscription(subscription);
    res.json({ ok: true });
  });

  app.post("/api/push/test", async (_req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!isPushConfigured()) {
      res.status(503).json({ error: "Push is not configured" });
      return;
    }
    await sendTestPush();
    res.json({ ok: true });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", updatedAt: state.latest?.date || null });
  });

  app.get("/debug/parse", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const url = typeof req.query.url === "string" ? req.query.url : getChannelUrl();
      const response = await fetch(url, {
        headers: {
          "User-Agent": "cherkasy-outage-watcher/0.1"
        }
      });
      if (!response.ok) {
        res.status(500).json({ error: `Failed to fetch ${response.status}` });
        return;
      }
      const html = await response.text();
      res.json(debugParse(html));
    } catch (error) {
      res.status(500).json({ error: "Parse failed" });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
  });
}
