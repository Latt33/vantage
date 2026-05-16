type DateLike = Date | number | string;

function toDate(value: DateLike): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

export function formatViewerDateTime(
  value: DateLike,
  options: { includeSeconds?: boolean; includeZone?: boolean } = {},
): string {
  const date = toDate(value);
  if (!isValidDate(date)) return typeof value === "string" ? value : "Invalid date";

  const formatterOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };

  if (options.includeSeconds) {
    formatterOptions.second = "2-digit";
  }

  if (options.includeZone) {
    formatterOptions.timeZoneName = "short";
  }

  return new Intl.DateTimeFormat("en-GB", formatterOptions).format(date);
}

export function formatViewerDateTimeInput(value: DateLike = new Date()): string {
  const date = toDate(value);
  if (!isValidDate(date)) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}