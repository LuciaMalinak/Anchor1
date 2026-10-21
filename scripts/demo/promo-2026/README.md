# Anchor promo video (vertical, 2026)

Output: `../out/anchor-promo-2026.mp4` — 1080×1920, 60 s, H.264 + AAC.
Every screen in it is the real website or desktop app, captured from a local
dev server with the fictional demo account (`/api/admin/seed-demo`). AI
responses are mocked in the capture scripts so nothing calls a model and no
real customer data is ever touched. The music bed is the track from the
earlier promo cut, extended to 60 s.

## Re-making it after the UI changes

1. Local Postgres + `npm run dev`; sign up `sam.rivera@example.com`, then hit
   `/api/admin/seed-demo?key=local-demo-only&email=...`. Save the session as a
   Playwright storage state (`state.json`).
2. For the integrations, CRM and Gmail tools to render as connected, set the
   `*_INTEGRATION_CLIENT_ID/SECRET` vars to any value and insert placeholder
   `integration_connection` rows (salesforce, slack, google with the
   `drive.readonly` scope) and a `salesforceOpportunityId` on the Acme deal.
   For the morning brief, insert a `morning_brief.lastBrief` snapshot and pass
   a token made like `createBriefToken` in `src/lib/briefLink.ts`.
3. Capture (writes PNGs into the output dir):
   ```
   DEAL_ID=... MEETING_ID=... BRIEF_TOKEN=... node capture-web.cjs <out> state.json
   DEAL_ID=... MEETING_ID=... BRIEF_TOKEN=... node capture-web-sections.cjs <out> state.json
   ```
   Desktop app: copy `desktop/src/renderer` to `<dir>/renderer`, add
   `desktop-stub.js` before `renderer.js` in its `index.html`, then
   `node capture-desktop.cjs <dir>` (writes to `<dir>/out`).
4. Real PowerPoint/Excel output: `npx tsx build-files.ts <dir>` (run from a
   copy inside `src/` so the `@/` imports resolve), then
   `soffice --headless --convert-to pdf` and `pdftoppm -png` for slide images.
5. Put all PNGs in `a/` next to `composer.html` (names as referenced there),
   check stills with `node preview.cjs <dir> 12 25.9 43.6`, then
   `node render.cjs <dir> video.mp4` and mux the music with ffmpeg.

`composer.html` holds the whole timeline: scene times in `SCENES`, camera
moves over each screenshot in `CAM`, and copy in the markup.

## v2: the knowledge-handoff cut

Output: `../out/anchor-promo-2026-v2.mp4` — 84 s, same format. Leads with what
makes Anchor different: someone else goes into the meeting carrying your
knowledge and judgment (handoff briefing, live answers in the owner's words,
"how would Sam handle it?", memory that stays with the company). Slower,
with every headline held long enough to read.

- `composer-v2.html` is the timeline for this cut.
- `capture-handoff.cjs`, `capture-recap-tools.cjs` and
  `capture-desktop-backup.cjs` capture its screens. Pages are captured at a
  560 px wide window and the desktop app at 620 px, so text stays readable
  in a vertical frame (change the viewport in each script).
- The demo deal needs a teammate set as Backup (the cut uses a fictional
  "Maya Chen" in the same team as the demo account).
