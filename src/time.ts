const KYIV_TIME_ZONE = "Europe/Kyiv";

export function formatDateTimeUA(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("uk-UA", {
    timeZone: KYIV_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
  return formatted.replace(/\sр\./, "");
}

export function formatDateUA(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("uk-UA", {
    timeZone: KYIV_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parsed);
  return formatted.replace(/\sр\./, "");
}

export function formatTimeUA(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: KYIV_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}
