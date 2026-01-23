import crypto from "crypto";
import { load as loadHtml } from "cheerio";
import { atomicWriteJson, ensureDataDir, readJsonFile, resolveDataPath } from "./storage";
import { sendScheduleUpdatePush } from "./push";

const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || "https://t.me/s/pat_cherkasyoblenergo";
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 300);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const latestPath = resolveDataPath("latest.json");
const historyPath = resolveDataPath("history.json");

export type OutageItem = {
  id: string;
  text: string;
  rawText?: string;
  date: string;
  url: string;
  schedule?: { queue: string; ranges: string[] }[];
  scheduleDateText?: string | null;
  scheduleDateIso?: string | null;
  contentHash: string;
};

export type State = {
  latest: OutageItem | null;
  history: OutageItem[];
};

export const state: State = {
  latest: null,
  history: []
};

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
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

function hashContent(rawText: string) {
  return crypto.createHash("sha256").update(rawText).digest("hex");
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
      scheduleDateIso,
      contentHash: hashContent(rawText)
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
  const nextItems: OutageItem[] = [];

  parsed.forEach((item) => {
    const existingIndex = state.history.findIndex((entry) => entry.id === item.id);
    if (existingIndex === -1) {
      state.history.push(item);
      nextItems.push(item);
      return;
    }

    const existing = state.history[existingIndex];
    if (existing.contentHash !== item.contentHash) {
      state.history[existingIndex] = item;
      nextItems.push(item);
    }
  });

  if (state.history.length > 1) {
    state.history.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (parsed.length > 0) {
    state.latest = pickLatestItem(parsed);
  }

  return nextItems;
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

async function notifyPush(newItems: OutageItem[]) {
  for (const item of newItems) {
    await sendScheduleUpdatePush(item);
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
    await notifyPush(newItems);
  } catch (error) {
    console.error("Polling failed", error);
  }
}

export async function startWatcher() {
  await ensureDataDir();
  const storedLatest = await readJsonFile<OutageItem | null>(latestPath, null);
  const storedHistory = await readJsonFile<OutageItem[]>(historyPath, []);
  state.latest =
    storedLatest && !storedLatest.contentHash
      ? { ...storedLatest, contentHash: hashContent(storedLatest.rawText || storedLatest.text) }
      : storedLatest;
  state.history = storedHistory.map((item) => {
    if (item.contentHash) return item;
    return { ...item, contentHash: hashContent(item.rawText || item.text) };
  });

  await pollChannel();
  setInterval(pollChannel, POLL_INTERVAL_SECONDS * 1000);
}

export function getChannelUrl() {
  return CHANNEL_URL;
}

export function debugParse(html: string) {
  const parsed = parseChannel(html);
  return { count: parsed.length, latest: pickLatestItem(parsed), items: parsed };
}
