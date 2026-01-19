import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import express from "express";
import { load as loadHtml } from "cheerio";

const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || "https://t.me/s/pat_cherkasyoblenergo";
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 300);
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const dataDir = path.resolve(process.cwd(), "data");
const latestPath = path.join(dataDir, "latest.json");
const historyPath = path.join(dataDir, "history.json");

type OutageItem = {
  id: string;
  text: string;
  date: string;
  url: string;
};

type State = {
  latest: OutageItem | null;
  history: OutageItem[];
};

const state: State = {
  latest: null,
  history: []
};

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(filePath: string, data: unknown) {
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tempPath, payload, "utf-8");
  await fs.rename(tempPath, filePath);
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function parseChannel(html: string): OutageItem[] {
  const $ = loadHtml(html);
  const items: OutageItem[] = [];

  $(".tgme_widget_message_wrap").each((_, element) => {
    const root = $(element);
    const postId = root.find(".tgme_widget_message").attr("data-post");
    if (!postId) return;

    const id = postId.split("/").pop();
    if (!id) return;

    const datetime = root.find(".tgme_widget_message_date time").attr("datetime") || "";
    const text = normalizeText(root.find(".tgme_widget_message_text").text() || "");
    if (!text) return;

    items.push({
      id,
      text,
      date: datetime,
      url: `https://t.me/pat_cherkasyoblenergo/${id}`
    });
  });

  return items;
}

async function fetchChannelHtml(): Promise<string> {
  const response = await fetch(CHANNEL_URL, {
    headers: {
      "User-Agent": "cherkasy-outage-watcher/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch channel: ${response.status}`);
  }

  return response.text();
}

function mergeHistory(parsed: OutageItem[]) {
  const existingIds = new Set(state.history.map((item) => item.id));
  let newItems: OutageItem[] = [];

  parsed.forEach((item) => {
    if (!existingIds.has(item.id)) {
      state.history.push(item);
      existingIds.add(item.id);
      newItems.push(item);
    }
  });

  if (state.history.length > 1) {
    state.history.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (parsed.length > 0) {
    state.latest = parsed[parsed.length - 1];
  }

  return newItems;
}

async function notifyTelegram(newItems: OutageItem[]) {
  if (!BOT_TOKEN || !CHAT_ID || newItems.length === 0) return;

  for (const item of newItems) {
    const message = `New update (${item.date}):\n${item.text}\n${item.url}`;
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = new URLSearchParams({
      chat_id: CHAT_ID,
      text: message,
      disable_web_page_preview: "true"
    });

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
  }
}

async function pollChannel() {
  try {
    const html = await fetchChannelHtml();
    const parsed = parseChannel(html);
    if (parsed.length === 0) return;

    const newItems = mergeHistory(parsed);
    await atomicWriteJson(latestPath, state.latest);
    await atomicWriteJson(historyPath, state.history);
    await notifyTelegram(newItems);
  } catch (error) {
    console.error("Polling failed", error);
  }
}

async function bootstrap() {
  await ensureDataDir();
  state.latest = await readJsonFile<OutageItem | null>(latestPath, null);
  state.history = await readJsonFile<OutageItem[]>(historyPath, []);

  await pollChannel();
  setInterval(pollChannel, POLL_INTERVAL_SECONDS * 1000);
}

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/", (_req, res) => {
  res.render("index", { latest: state.latest, sourceUrl: CHANNEL_URL });
});

app.get("/history", (_req, res) => {
  res.render("history", { history: [...state.history].reverse() });
});

app.get("/api/latest", (_req, res) => {
  res.json(state.latest);
});

app.get("/api/history", (_req, res) => {
  res.json(state.history);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", updatedAt: state.latest?.date || null });
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});

bootstrap().catch((error) => {
  console.error("Failed to start", error);
});
