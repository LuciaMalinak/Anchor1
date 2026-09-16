// Best-effort company logo, derived from a domain rather than fetched
// or stored — no photo of any actual person is ever involved here, only
// a company's own public brand mark. Uses Clearbit's long-standing free
// logo endpoint (no key required); callers must handle the <img> failing
// to load (it 404s for an unrecognized domain) with a fallback, since
// this is never guaranteed to resolve.
function extractDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Looks like an email address — use the part after @.
  if (trimmed.includes("@") && !trimmed.includes("/")) {
    const domain = trimmed.split("@")[1];
    return domain || null;
  }

  try {
    const withProtocol = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function getCompanyLogoUrl(
  companyWebsite: string | null | undefined,
  fallbackContactEmail?: string | null
): string | null {
  const domain = extractDomain(companyWebsite) || extractDomain(fallbackContactEmail);
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}
