import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deals } from "@/db/schema";

// Links shown under a live answer for the people and company it's about:
// whoever asked, and any of the rep's contacts or the deal's company the
// question or answer names. Built only from what Anchor already knows (a
// contact's saved LinkedIn profile, the deal's website), otherwise a
// LinkedIn or web search for the name, so no link is ever made up.

export type LiveLink = { label: string; url: string };

const MAX_LINKS = 4;

function linkedInSearch(name: string, company: string | null): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company ? `${name} ${company}` : name)}`;
}

function mentions(haystack: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return false;
  return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
}

function websiteUrl(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

export async function liveLinksFor(params: {
  userId: string;
  deal: typeof deals.$inferSelect | null;
  askedBy: string | null;
  texts: string[];
}): Promise<LiveLink[]> {
  const haystack = params.texts.join("\n");
  const people = await db
    .select({ name: contacts.name, company: contacts.company, linkedinUrl: contacts.linkedinUrl })
    .from(contacts)
    .where(eq(contacts.userId, params.userId));
  const company = params.deal ? params.deal.name.split(/\s+[—–-]\s+|:\s+|\s+\|\s+/)[0].trim() : null;

  const links: LiveLink[] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string) => {
    if (seen.has(url) || links.length >= MAX_LINKS) return;
    seen.add(url);
    links.push({ label, url });
  };

  const personLink = (name: string) => {
    const known = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    add(name, known?.linkedinUrl || linkedInSearch(name, known?.company ?? company));
  };
  if (params.askedBy) personLink(params.askedBy);
  for (const p of people) if (mentions(haystack, p.name)) personLink(p.name);

  if (company) {
    const site = params.deal?.companyWebsite;
    add(company, site ? websiteUrl(site) : `https://www.google.com/search?q=${encodeURIComponent(company)}`);
  }
  return links;
}
