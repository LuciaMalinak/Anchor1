import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "@/lib/aiUsage";
import { createWithForcedTool } from "@/lib/forcedTool";
import { signUpUrl, type LinkedInBotSettings } from "./settings";
import { MAIN_MODEL } from "@/lib/aiModels";

// The writing behind the LinkedIn bot: the daily posts, the weekly video's
// slides, today's companies to engage with, and comment drafts. Same model
// and structured-output pattern as the rest of Anchor.
const MODEL = MAIN_MODEL;

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey, fetch: meteredFetch("linkedin_bot") });
}

// The posts exist to win clients: every one is about Anchor and how it
// helps a company grow, and ends by asking the reader to sign up.
function voice(settings: LinkedInBotSettings): string {
  const link = signUpUrl(settings);
  return `How the company writes on LinkedIn:
- Every post is about Anchor: a real problem dealmakers, bankers, advisors or B2B sales teams have, how Anchor solves it, and what that means for their growth (more deals closed, faster follow-ups, nothing dropped between calls, hours back each week).
- Sharp, practical and specific, like a former investment banker who built the tool she wished she'd had. Confident and persuasive, not hyped.
- First line is a hook that makes a dealmaker or salesperson stop scrolling (a concrete pain, a sharp question, or a number from the research notes). No "In today's fast-paced world", no "game-changer", no "Let's dive in", no "Here's the thing".
- Short paragraphs of 1-2 sentences with blank lines between them. Plain words. At most one emoji, usually none. No em dashes.
- Show Anchor in action: describe what it actually does in a real moment (before a call, during it, after it) using only the features in the company description.
- Comparison posts compare Anchor with categories of tools ("typical AI note-takers", "a general AI chatbot", "your CRM notes"), never with named products or companies, and only on the differences stated in the company description. Fair and confident, never disparaging.
- Never invent customers, testimonials, quotes, results, statistics or news. Only use figures that appear in the research notes, naming the source ("per PitchBook"). Don't promise outcomes as facts about Anchor's users.
- End with a clear call to action to sign up, e.g. "Start free with Anchor: ${link || "[link]"}" or "Sign up now: ${link || "[link]"}" (vary the wording; the link exactly as given, on its own line), then 3 relevant hashtags on the last line (e.g. #SalesAI #Dealmaking #AIAnchor).`;
}

function company(settings: LinkedInBotSettings): string {
  return `The company: ${settings.about}`;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function toolInput<T>(message: Anthropic.Message, name: string): T {
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === name);
  if (!block) throw new Error(`The model didn't return ${name}`);
  return block.input as T;
}

// A few fresh, real items from this week's news on the topics, found with
// web search, so posts can be timely without making anything up. Returns
// "" if search finds nothing or fails; the posts are then evergreen.
export async function researchNotes(settings: LinkedInBotSettings, todayLabel: string): Promise<string> {
  try {
    const message = await client().messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        "You research material for a company's LinkedIn posts. Use web search to find real, recent items. Report only what you found, with the source name and date for each.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [
        {
          role: "user",
          content: `Today is ${todayLabel}. ${company(settings)}\n\nFind 5-8 notable items from the past 7 days relevant to these post topics:\n${settings.topics.map((t) => `- ${t}`).join("\n")}\n\nGood items: M&A and dealmaking activity or data (deal volumes, notable deals, banking trends), new research or data on AI in sales and advisory work, notable AI product launches for sales/meetings. For each give one line: what happened, the key number if any, source, date. No preamble.`,
        },
      ],
    });
    return textOf(message).slice(0, 4000);
  } catch (err) {
    console.error("[linkedinBot] research failed:", err);
    return "";
  }
}

export type DraftPost = { topic: string; text: string };

const POSTS_TOOL: Anthropic.Tool = {
  name: "record_posts",
  description: "Record the LinkedIn posts.",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Which topic this post is on, in 2-5 words." },
            text: { type: "string", description: "The full post, 120-220 words, ready to publish." },
          },
          required: ["topic", "text"],
        },
      },
    },
    required: ["posts"],
  },
};

export async function writePosts(params: {
  settings: LinkedInBotSettings;
  count: number;
  recent: string[];
  notes: string;
  todayLabel: string;
}): Promise<DraftPost[]> {
  const { settings, count, recent, notes, todayLabel } = params;
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 4000,
    system: `You write the company LinkedIn Page posts for AI Anchor.\n\n${company(settings)}\n\n${voice(settings)}`,
    tools: [POSTS_TOOL],
    tool_choice: { type: "tool", name: "record_posts" },
    messages: [
      {
        role: "user",
        content: `Today is ${todayLabel}. Write ${count} LinkedIn posts for today that make people want to try Anchor, each on a DIFFERENT one of these topics (pick the topics that have been used least recently):\n${settings.topics.map((t) => `- ${t}`).join("\n")}\n\nResearch notes from this week (the only facts and figures you may cite):\n${notes || "(none today: write posts with no statistics or news)"}\n\nRecent posts (don't repeat their angle, hook or opening words):\n${recent.length ? recent.map((r) => `- ${r}`).join("\n") : "(none yet)"}`,
      },
    ],
  });
  const { posts } = toolInput<{ posts: DraftPost[] }>(message, "record_posts");
  return (posts ?? []).filter((p) => p.text?.trim()).slice(0, count);
}

export type Slide = { title: string; body: string };
export type DraftVideo = { topic: string; title: string; caption: string; slides: Slide[] };

const VIDEO_TOOL: Anthropic.Tool = {
  name: "record_video",
  description: "Record the weekly video: its slides and the post caption.",
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Topic in 2-5 words." },
      title: { type: "string", description: "Video title, at most 60 characters." },
      slides: {
        type: "array",
        description:
          "5-6 slides shown about 6 seconds each. Slide 1 is the hook; the last slide is the call to sign up. Each slide: a title of at most 7 words and a body of at most 22 words.",
        items: {
          type: "object",
          properties: { title: { type: "string" }, body: { type: "string" } },
          required: ["title", "body"],
        },
      },
      caption: {
        type: "string",
        description: "The post text that goes with the video, 60-120 words, ending with the sign-up call to action and link, then 3 hashtags.",
      },
    },
    required: ["topic", "title", "slides", "caption"],
  },
};

export async function writeVideo(params: {
  settings: LinkedInBotSettings;
  recent: string[];
  notes: string;
  todayLabel: string;
}): Promise<DraftVideo> {
  const { settings, recent, notes, todayLabel } = params;
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 3000,
    system: `You make a short weekly slide video (30-40 seconds, text on screen, no voice) for the AI Anchor LinkedIn Page.\n\n${company(settings)}\n\n${voice(settings)}`,
    tools: [VIDEO_TOOL],
    tool_choice: { type: "tool", name: "record_video" },
    messages: [
      {
        role: "user",
        content: `Today is ${todayLabel}. Make this week's video about Anchor on one of these topics: show a problem, then how Anchor solves it step by step. The last slide is the call to action: its title is "Start free with Anchor" (or similar) and its body is the sign-up link ${signUpUrl(settings) || "(no link available: say 'Search AI Anchor on LinkedIn')"}.\n${settings.topics.map((t) => `- ${t}`).join("\n")}\n\nResearch notes (the only facts and figures you may cite):\n${notes || "(none: no statistics or news)"}\n\nRecent posts (pick a different angle):\n${recent.length ? recent.map((r) => `- ${r}`).join("\n") : "(none yet)"}`,
      },
    ],
  });
  const v = toolInput<DraftVideo>(message, "record_video");
  const slides = (v.slides ?? []).filter((s) => s.title?.trim()).slice(0, 7);
  if (slides.length < 3) throw new Error("The video came back with too few slides");
  return { topic: v.topic, title: (v.title ?? "").slice(0, 100), caption: v.caption, slides };
}

export type EngagementTarget = { name: string; why: string; angle: string };

const ENGAGE_TOOL: Anthropic.Tool = {
  name: "record_targets",
  description: "Record today's companies and people to engage with.",
  input_schema: {
    type: "object",
    properties: {
      targets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Company or person name, exactly as on LinkedIn." },
            why: { type: "string", description: "Why engaging with them helps AI Anchor, one short sentence." },
            angle: {
              type: "string",
              description: "What AI Anchor can add in a comment on their posts (a perspective, not a pitch), one short sentence.",
            },
          },
          required: ["name", "why", "angle"],
        },
      },
    },
    required: ["targets"],
  },
};

// Today's 5 companies or people in the sector to comment on. From the
// watchlist when there is one; otherwise suggested from what's active in
// the sector this week.
export async function pickEngagementTargets(settings: LinkedInBotSettings, notes: string): Promise<EngagementTarget[]> {
  const fromList = settings.watchlist.length
    ? `Choose 5 from this watchlist, rotating so different ones come up on different days (today's date seed: ${new Date().toISOString().slice(0, 10)}):\n${settings.watchlist.map((w) => `- ${w}`).join("\n")}`
    : "Suggest 5 real companies or well-known people active on LinkedIn whose audience overlaps AI Anchor's buyers: M&A advisory firms and boutique banks, deal and PE media, sales-AI and meeting-AI companies, and sales leaders. Prefer ones in this week's research notes.";
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 1500,
    system: `You plan a company's daily LinkedIn engagement: thoughtful comments on other companies' posts that build credibility with the right audience.\n\n${company(settings)}`,
    tools: [ENGAGE_TOOL],
    tool_choice: { type: "tool", name: "record_targets" },
    messages: [{ role: "user", content: `${fromList}\n\nThis week's research notes:\n${notes || "(none)"}` }],
  });
  return (toolInput<{ targets: EngagementTarget[] }>(message, "record_targets").targets ?? []).slice(0, 5);
}

const COMMENTS_TOOL: Anthropic.Tool = {
  name: "record_comments",
  description: "Record comment options.",
  input_schema: {
    type: "object",
    properties: {
      comments: {
        type: "array",
        description: "3 different comment options.",
        items: { type: "string" },
      },
    },
    required: ["comments"],
  },
};

// Three comment options for someone else's post, written as the AI Anchor
// Page: add a real point to the conversation, never pitch.
export async function draftComments(settings: LinkedInBotSettings, postText: string, author: string): Promise<string[]> {
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 1500,
    system: `You write LinkedIn comments posted by the AI Anchor company Page on other people's posts.\n\n${company(settings)}\n\nA good comment: 25-70 words, responds to something specific in the post, adds one real insight, example or sharp question from a dealmaking / sales-AI perspective. Sounds like a thoughtful person, not a brand. No pitch, no links, no "Great post!", no hashtags, no emoji, no em dashes. Never claim facts that aren't in the post or common knowledge.`,
    tools: [COMMENTS_TOOL],
    tool_choice: { type: "tool", name: "record_comments" },
    messages: [
      {
        role: "user",
        content: `Post by ${author || "(unknown)"}:\n"""\n${postText.slice(0, 6000)}\n"""\n\nWrite 3 different comment options: one that adds an insight, one that shares a practical tip, one that asks a smart question.`,
      },
    ],
  });
  return (toolInput<{ comments: string[] }>(message, "record_comments").comments ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export type PostToComment = { url: string; author: string; postText: string; comments: string[] };

function sameLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const PICKS_TOOL: Anthropic.Tool = {
  name: "record_picks",
  description: "Record the posts to comment on and the comment options for each.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string", description: "The post's LinkedIn URL, exactly as found." },
            author: { type: "string", description: "Who posted it." },
            postText: { type: "string", description: "What the post says, 1-3 sentences, from what was found." },
            comments: { type: "array", items: { type: "string" }, description: "3 different comment options." },
          },
          required: ["url", "author", "postText", "comments"],
        },
      },
    },
    required: ["picks"],
  },
};

// Today's posts to comment on: real, recent public LinkedIn posts in the
// space found with web search, each with 3 comment options written as the
// AI Anchor Page. Only links that actually came back from the search are
// kept, so a made-up link can never be suggested. Commenting itself stays
// with a person (LinkedIn doesn't allow it to be automated).
export async function findPostsToComment(
  settings: LinkedInBotSettings,
  count: number,
  skipUrls: string[],
): Promise<PostToComment[]> {
  const search = await client().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system:
      "You find recent public LinkedIn posts for a company to comment on. Use web search. Report only posts you actually found, with their exact URL.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    messages: [
      {
        role: "user",
        content: `${company(settings)}\n\nFind ${count * 2} public LinkedIn posts from the past 7 days (URLs on linkedin.com/posts/ or linkedin.com/feed/update/) by companies or people whose audience could become Anchor clients: M&A advisors and boutique banks, private equity and deal professionals, B2B sales leaders, sales-AI and meeting-AI companies, deal and PE media.${settings.watchlist.length ? ` Prefer these: ${settings.watchlist.join(", ")}.` : ""} Good searches: site:linkedin.com/posts with terms like "M&A", "dealmaking", "sales team", "AI meeting notes", "client calls". For each post give its exact URL, the author, and what it says.`,
      },
    ],
  });
  const found = new Set<string>();
  for (const block of search.content as unknown as { type: string; content?: unknown }[]) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content as { url?: string }[]) {
      if (r.url && /linkedin\.com\/(posts|feed\/update)\//i.test(r.url)) found.add(sameLink(r.url));
    }
  }
  const skip = new Set(skipUrls.map(sameLink));
  const findings = textOf(search);
  if (!found.size || !findings) return [];

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 4000,
    system: `You write LinkedIn comments posted by the AI Anchor company Page on other people's posts, to grow its followers and get noticed by future clients.\n\n${company(settings)}\n\nA good comment: 25-70 words, responds to something specific in the post, adds one real insight, example or sharp question from a dealmaking / sales-AI perspective. Sounds like a thoughtful founder, not a brand or an ad. No pitch, no links, no "Great post!", no hashtags, no emoji, no em dashes. It may mention how teams use AI for client calls, but never pushes Anchor. Never claim facts that aren't in the post or common knowledge.`,
    tools: [PICKS_TOOL],
    tool_choice: { type: "tool", name: "record_picks" },
    messages: [
      {
        role: "user",
        content: `Posts found today:\n${findings.slice(0, 8000)}\n\nPick the ${count} best posts to comment on (most relevant to Anchor's future clients, most active or influential authors) and write 3 comment options for each: one adding an insight, one sharing a practical tip, one asking a smart question.`,
      },
    ],
  });
  const picks = toolInput<{ picks: PostToComment[] }>(message, "record_picks").picks ?? [];
  const seen = new Set<string>();
  return picks
    .filter((p) => {
      const key = sameLink(p.url ?? "");
      if (!found.has(key) || skip.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      url: p.url,
      author: (p.author ?? "").slice(0, 120),
      postText: (p.postText ?? "").slice(0, 600),
      comments: (p.comments ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 3),
    }))
    .filter((p) => p.comments.length)
    .slice(0, count);
}
