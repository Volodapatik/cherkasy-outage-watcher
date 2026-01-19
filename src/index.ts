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
  rawText?: string;
  date: string;
  url: string;
  schedule?: { queue: string; ranges: string[] }[];
  scheduleDateText?: string | null;
  scheduleDateIso?: string | null;
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

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function extractRawText(element: { html: () => string | null }) {
  const html = element.html() || "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n");
  const $ = loadHtml(`<div>${withBreaks}</div>`);
  const text = $("body").text();
  const lines = text.replace(/\r/g, "").split("\n").map((line: string) => line.trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const monthMap: Record<string, string> = {
  "січня": "01",
  "лютого": "02",
  "березня": "03",
  "квітня": "04",
  "травня": "05",
  "червня": "06",
  "липня": "07",
  "серпня": "08",
  "вересня": "09",
  "жовтня": "10",
  "листопада": "11",
  "грудня": "12"
};

function parseScheduleDate(rawText: string) {
  const dateRegex =
    /(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/i;
  const match = rawText.match(dateRegex);
  if (!match) {
    return { scheduleDateText: null, scheduleDateIso: null };
  }
  const day = match[1].padStart(2, "0");
  const monthName = match[2].toLowerCase();
  const monthNumber = monthMap[monthName];
  const year = new Date().getFullYear();
  return {
    scheduleDateText: `${Number(match[1])} ${monthName}`,
    scheduleDateIso: monthNumber ? `${year}-${monthNumber}-${day}` : null
  };
}

function normalizeTime(value: string) {
  const [hours, minutes] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function parseSchedule(rawText: string) {
  const compact = rawText.replace(/\s+/g, " ").trim();
  const queueRegex = /(^|[\s\n])([1-6]\.[12])\s+/g;
  const matches: { queue: string; index: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = queueRegex.exec(compact)) !== null) {
    const offset = match[1]?.length || 0;
    matches.push({ queue: match[2], index: match.index + offset });
  }

  const schedule: { queue: string; ranges: string[] }[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : compact.length;
    const segment = compact.slice(start, end);
    const rangeRegex = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/g;
    const ranges: string[] = [];
    let rangeMatch: RegExpExecArray | null;

    while ((rangeMatch = rangeRegex.exec(segment)) !== null) {
      ranges.push(`${normalizeTime(rangeMatch[1])}-${normalizeTime(rangeMatch[2])}`);
    }

    if (ranges.length > 0) {
      schedule.push({ queue: matches[i].queue, ranges });
    }
  }

  return schedule;
}

function isScheduleUpdate(rawText: string) {
  const schedule = parseSchedule(rawText);
  return schedule.length >= 4 ? schedule : null;
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
    const messageNode = root.find(".tgme_widget_message_text");
    const rawText = extractRawText(messageNode);
    if (!rawText) return;
    const text = normalizeText(rawText);
    const schedule = isScheduleUpdate(rawText);
    if (!schedule) return;
    const { scheduleDateText, scheduleDateIso } = parseScheduleDate(rawText);

    items.push({
      id,
      text,
      rawText,
      date: datetime,
      url: `https://t.me/pat_cherkasyoblenergo/${id}`,
      schedule,
      scheduleDateText,
      scheduleDateIso
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

function pickLatestItem(items: OutageItem[]) {
  return items.reduce<OutageItem | null>((latest, item) => {
    if (!latest) return item;
    const latestId = Number(latest.id);
    const itemId = Number(item.id);
    if (!Number.isNaN(latestId) && !Number.isNaN(itemId)) {
      return itemId > latestId ? item : latest;
    }
    return item.date > latest.date ? item : latest;
  }, null);
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
    state.latest = pickLatestItem(parsed);
  }

  return newItems;
}

function formatScheduleLog(item: OutageItem) {
  if (!item.schedule || item.schedule.length === 0) return "";
  const lines = item.schedule.map((entry) => `${entry.queue}: ${entry.ranges.join(", ")}`);
  return lines.join("\n");
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
    newItems.forEach((item) => {
      const scheduleLog = formatScheduleLog(item);
      console.log(`Saved schedule ${item.id} (${item.date})`);
      if (scheduleLog) {
        console.log(scheduleLog);
      }
    });
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
  res.render("index", {
    latest: state.latest,
    sourceUrl: CHANNEL_URL,
    formatDateTime
  });
});

app.get("/history", (_req, res) => {
  res.render("history", {
    history: [...state.history].reverse(),
    formatDateTime
  });
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

app.get("/debug/parse", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    const url = typeof req.query.url === "string" ? req.query.url : CHANNEL_URL;
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
    const parsed = parseChannel(html);
    res.json({ count: parsed.length, latest: pickLatestItem(parsed), items: parsed });
  } catch (error) {
    res.status(500).json({ error: "Parse failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});

bootstrap().catch((error) => {
  console.error("Failed to start", error);
});
