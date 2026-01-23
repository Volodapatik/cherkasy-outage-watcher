const enableButton = document.getElementById("push-enable");
const disableButton = document.getElementById("push-disable");
const permissionEl = document.getElementById("push-permission");
const statusEl = document.getElementById("push-status");
const deniedEl = document.getElementById("push-denied");

const supportsPush =
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

function setPermissionText(value) {
  permissionEl.textContent = `Стан дозволу: ${value}`;
  deniedEl.hidden = value !== "denied";
}

function setStatusText(value) {
  statusEl.textContent = `Стан підписки: ${value}`;
}

function setButtons({ canEnable, canDisable }) {
  enableButton.disabled = !canEnable;
  disableButton.disabled = !canDisable;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function fetchPublicKey() {
  const response = await fetch("/api/push/public-key");
  if (!response.ok) {
    throw new Error("Push is not configured");
  }
  const data = await response.json();
  return data.publicKey;
}

async function getRegistration() {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

async function getSubscription(registration) {
  return registration.pushManager.getSubscription();
}

async function refreshUi(registration) {
  const permission = Notification.permission;
  setPermissionText(permission);

  if (permission === "denied") {
    setStatusText("вимкнена");
    setButtons({ canEnable: false, canDisable: false });
    return;
  }

  const subscription = await getSubscription(registration);
  if (subscription) {
    setStatusText("активна");
    setButtons({ canEnable: false, canDisable: true });
  } else {
    setStatusText("не активна");
    setButtons({ canEnable: true, canDisable: false });
  }
}

async function enablePush(registration) {
  const permission = await Notification.requestPermission();
  setPermissionText(permission);
  if (permission !== "granted") {
    await refreshUi(registration);
    return;
  }

  let publicKey;
  try {
    publicKey = await fetchPublicKey();
  } catch (error) {
    setStatusText("не налаштована");
    return;
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription)
  });

  await refreshUi(registration);
}

async function disablePush(registration) {
  const subscription = await getSubscription(registration);
  if (!subscription) {
    await refreshUi(registration);
    return;
  }

  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });

  await subscription.unsubscribe();
  await refreshUi(registration);
}

async function init() {
  if (!supportsPush) {
    setPermissionText("unsupported");
    setStatusText("недоступна");
    setButtons({ canEnable: false, canDisable: false });
    return;
  }

  const registration = await getRegistration();
  await refreshUi(registration);

  enableButton.addEventListener("click", () => {
    enablePush(registration).catch(() => {
      setStatusText("помилка");
    });
  });

  disableButton.addEventListener("click", () => {
    disablePush(registration).catch(() => {
      setStatusText("помилка");
    });
  });
}

if (enableButton && disableButton && permissionEl && statusEl && deniedEl) {
  init().catch(() => {
    setStatusText("помилка");
  });
}
