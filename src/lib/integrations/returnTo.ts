// Where to send someone after an integration's OAuth round trip. Only a
// path on this site is allowed, never another origin: "/x" is fine, but
// "//evil.com" and "/\evil.com" are protocol-relative URLs to another host.
export function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
