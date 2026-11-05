// Talking to LinkedIn for the company Page: signing in (OAuth), finding
// the Page, publishing posts and uploading videos.
//
// This needs its own LinkedIn developer app with the "Community Management
// API" product (LinkedIn doesn't allow that product on the same app as
// "Sign In with LinkedIn", which Anchor's sign-in app already has), set as
// LINKEDIN_PAGE_CLIENT_ID / LINKEDIN_PAGE_CLIENT_SECRET.

const API = "https://api.linkedin.com/rest";
// LinkedIn's REST API is versioned by month (YYYYMM) and each version is
// served for about a year; override with LINKEDIN_API_VERSION when this
// one is retired.
const API_VERSION = process.env.LINKEDIN_API_VERSION || "202606";

export const PAGE_SCOPES = ["w_organization_social", "r_organization_social", "rw_organization_admin"];

export function pageAppConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_PAGE_CLIENT_ID && process.env.LINKEDIN_PAGE_CLIENT_SECRET);
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_PAGE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    state,
    scope: PAGE_SCOPES.join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date;
  refreshExpiresAt: Date | null;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: process.env.LINKEDIN_PAGE_CLIENT_ID ?? "",
      client_secret: process.env.LINKEDIN_PAGE_CLIENT_SECRET ?? "",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new Error(`LinkedIn sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  const now = Date.now();
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    tokenExpiresAt: new Date(now + Number(data.expires_in ?? 0) * 1000),
    refreshExpiresAt:
      typeof data.refresh_token_expires_in === "number" ? new Date(now + data.refresh_token_expires_in * 1000) : null,
  };
}

export function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export class LinkedInError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) detail = j.message;
    } catch {}
    throw new LinkedInError(`LinkedIn ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status}): ${detail}`, res.status);
  }
  return res;
}

export type PageInfo = { urn: string; name: string };

// The company Pages this LinkedIn account administers.
export async function listAdminPages(token: string): Promise<PageInfo[]> {
  const res = await call(token, "/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED");
  const data = (await res.json()) as { elements?: { organization?: string }[] };
  const urns = [...new Set((data.elements ?? []).map((e) => e.organization).filter((u): u is string => !!u))];
  const pages: PageInfo[] = [];
  for (const urn of urns) {
    const id = urn.split(":").pop();
    try {
      const org = (await (await call(token, `/organizations/${id}`)).json()) as { localizedName?: string };
      pages.push({ urn, name: org.localizedName ?? urn });
    } catch {
      pages.push({ urn, name: urn });
    }
  }
  return pages;
}

// LinkedIn's post text format treats these characters as markup, so they
// must be escaped; #words become real hashtags.
export function toLittleText(text: string): string {
  const escape = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/(^|[^\w&])#([A-Za-z][A-Za-z0-9]*)/g)) {
    const start = m.index! + m[1].length;
    out += escape(text.slice(last, start)) + `{hashtag|\\#|${m[2]}}`;
    last = start + 1 + m[2].length;
  }
  return out + escape(text.slice(last));
}

// Publishes a post on the Page and returns its URN.
export async function createPost(
  token: string,
  orgUrn: string,
  text: string,
  video?: { urn: string; title: string },
): Promise<string> {
  const body: Record<string, unknown> = {
    author: orgUrn,
    commentary: toLittleText(text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (video) body.content = { media: { title: video.title, id: video.urn } };
  const res = await call(token, "/posts", { method: "POST", body: JSON.stringify(body) });
  return res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
}

// Uploads an MP4 for the Page and waits until LinkedIn has processed it.
export async function uploadVideo(token: string, orgUrn: string, data: Buffer): Promise<string> {
  const init = (await (
    await call(token, "/videos?action=initializeUpload", {
      method: "POST",
      body: JSON.stringify({
        initializeUploadRequest: { owner: orgUrn, fileSizeBytes: data.length, uploadCaptions: false, uploadThumbnail: false },
      }),
    })
  ).json()) as {
    value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
  };
  const { video, uploadToken = "", uploadInstructions } = init.value;
  const etags: string[] = [];
  for (const part of uploadInstructions) {
    const res = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data.subarray(part.firstByte, part.lastByte + 1)),
    });
    if (!res.ok) throw new LinkedInError(`LinkedIn video upload failed (${res.status})`, res.status);
    etags.push(res.headers.get("etag") ?? "");
  }
  await call(token, "/videos?action=finalizeUpload", {
    method: "POST",
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds: etags } }),
  });
  // Processing usually takes well under a minute for a short clip.
  for (let i = 0; i < 40; i++) {
    const v = (await (await call(token, `/videos/${encodeURIComponent(video)}`)).json()) as { status?: string };
    if (v.status === "AVAILABLE") return video;
    if (v.status === "PROCESSING_FAILED") throw new Error("LinkedIn couldn't process the video");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("LinkedIn is still processing the video; it will be tried again");
}

// A post's public link, from its URN.
export function postUrl(urn: string | null | undefined): string | null {
  return urn ? `https://www.linkedin.com/feed/update/${urn}/` : null;
}
