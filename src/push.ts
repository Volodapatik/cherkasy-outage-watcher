import webpush, { PushSubscription } from "web-push";
import { atomicWriteJson, ensureDataDir, readJsonFile, resolveDataPath } from "./storage";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "";
const MAX_SUBSCRIPTIONS = 500;

const subscriptionsPath = resolveDataPath("subscriptions.json");
const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function isPushConfigured() {
  return pushEnabled;
}

export function getPublicKey() {
  return VAPID_PUBLIC_KEY;
}

export async function loadSubscriptions() {
  await ensureDataDir();
  return readJsonFile<PushSubscription[]>(subscriptionsPath, []);
}

async function saveSubscriptions(subscriptions: PushSubscription[]) {
  const trimmed = subscriptions.slice(-MAX_SUBSCRIPTIONS);
  await atomicWriteJson(subscriptionsPath, trimmed);
  return trimmed;
}

export async function addSubscription(subscription: PushSubscription) {
  if (!subscription?.endpoint) return 0;
  const subscriptions = await loadSubscriptions();
  const existingIndex = subscriptions.findIndex((item) => item.endpoint === subscription.endpoint);
  if (existingIndex >= 0) {
    subscriptions[existingIndex] = subscription;
  } else {
    subscriptions.push(subscription);
  }
  await saveSubscriptions(subscriptions);
  return subscriptions.length;
}

export async function removeSubscription(
  input: PushSubscription | { endpoint?: string } | string | null
) {
  const endpoint = typeof input === "string" ? input : input?.endpoint;
  if (!endpoint) return 0;
  const subscriptions = await loadSubscriptions();
  const filtered = subscriptions.filter((item) => item.endpoint !== endpoint);
  if (filtered.length !== subscriptions.length) {
    await saveSubscriptions(filtered);
  }
  return filtered.length;
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

async function sendPushToAll(payload: PushPayload) {
  if (!pushEnabled) return;
  const subscriptions = await loadSubscriptions();
  if (subscriptions.length === 0) return;

  const nextSubscriptions: PushSubscription[] = [];
  const body = JSON.stringify(payload);

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, body);
      nextSubscriptions.push(subscription);
    } catch (error: any) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        continue;
      }
      nextSubscriptions.push(subscription);
      console.error("Failed to send push", statusCode || error);
    }
  }

  if (nextSubscriptions.length !== subscriptions.length) {
    await saveSubscriptions(nextSubscriptions);
  }
}

export async function sendPush(payload: PushPayload) {
  await sendPushToAll(payload);
}
