export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = -1;
  do { value /= 1024; index += 1; } while (value >= 1024 && index < units.length - 1);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

export function formatRemaining(timestamp: number | null): string {
  if (!timestamp) return "Pinned";
  const milliseconds = timestamp - Date.now();
  if (milliseconds <= 0) return "Expired";
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} hr left`;
  return `${Math.ceil(hours / 24)} days left`;
}

export function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}
