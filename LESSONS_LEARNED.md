# Lessons Learned

## Rule: Don't assume API behaviour — verify first

**What happened (v0.3.0 → v0.3.1):**
Switched Cloud Vision API from `base64` image content to `imageUri` as a performance optimisation, assuming Cloud Vision could fetch Street View URLs server-side. It couldn't — API key domain restrictions blocked it. All images scored 0, every location was rejected, the app broke with "No usable Street View images found".

**The fix was one function revert.** But it was handled badly — attempted inline edits in chat instead of immediately handing off to Claude Code.

**Rules going forward:**
1. **Never assume third-party API behaviour** — especially cross-service calls (e.g. Vision fetching a Maps URL). Test it or find documentation that explicitly confirms it works.
2. **Don't make optimisations to working code without a fallback plan.**
3. **If a fix requires editing a file, give a Claude Code prompt immediately** — don't attempt multi-step inline edits in chat. Claude Code is faster, more reliable, and less error-prone for file changes.

---

## Rule: For any code file changes, use Claude Code

When a bug fix or feature requires editing `public/index.html` or any project file:

- **Do:** Write a clear Claude Code prompt and hand off
- **Don't:** Attempt to push full file replacements via chat MCP tools

**Template Claude Code prompt:**
```
In [filename], find [function/section]. 
Replace [specific thing] with [specific thing].
Commit with message "[type]: description" and push to main.
```

---

## Known API constraints

### Cloud Vision + Street View URLs
- Cloud Vision `imageUri` **cannot** fetch Google Street View Static API URLs
- Likely cause: API key has domain/referrer restrictions; Vision servers don't match
- **Always use base64**: fetch image in browser → FileReader → base64 → Vision `content` field
- This is slower per image but reliable. Parallel batching (v0.3.0) offsets the cost.

### Supabase RLS + anon writes
- By default, RLS blocks anon inserts
- Temporary policy added: `"Anon insert (temporary)"` on `location_library`
- Phase 3 TODO: move location saving to a Vercel Edge Function using service role key, then remove anon insert policy

---

## v0.4.0 migration: static HTML → Next.js

### Lesson: imageUri bug will recur if you forget why base64 exists

**What happened:** During the v0.4.0 migration, the Vision API route was written using `imageUri` again — the same approach that broke v0.3.0. The symptom was identical: new locations failed with "No usable Street View images found", while cached locations worked fine. The fix was the same: fetch the image server-side and send as base64.

**Rule:** The Vision API route must always use base64. This is now enforced server-side in `src/app/api/vision/route.js` — the route fetches the Street View image itself and converts to base64 before calling Vision. This is actually better than the old client-side base64 approach because the image never transits through the browser.

### Lesson: Vercel project settings override vercel.json

**What happened:** The old project had `"outputDirectory": "dist"` and `"buildCommand": "node build.js"` set in Vercel project-level settings. Adding a `vercel.json` with `"framework": "nextjs"` to the repo did not override these — the build still looked for `dist/` and failed. The fix required changing settings in the Vercel dashboard (Project Settings > General > Build & Development Settings).

**Rule:** When changing frameworks on an existing Vercel project, always update the dashboard settings — Framework Preset, Build Command, and Output Directory. Turn off all overrides and let the framework defaults take over. `vercel.json` alone is not enough.

### Lesson: Unrelated git histories make merging painful

**What happened:** The v0.4.0 branch was created with `git init` in a fresh directory rather than branching from `main`. This meant GitHub refused to create a PR ("no history in common"), and merging locally required `--allow-unrelated-histories` with manual conflict resolution on every shared file.

**Rule:** Always branch from the existing repo, even for major rewrites. Use `git checkout -b v2-nextjs main` — not `git init`. This preserves history and makes PRs/merges straightforward.

### Lesson: Keep environment variables simple

**What happened:** The initial v0.4.0 setup split the Google API key into two env vars (`NEXT_PUBLIC_GOOGLE_MAPS_KEY` for client-side Maps JS, `GOOGLE_API_KEY` for server-side). This caused confusion — they used the same key. Simplified to just `GOOGLE_API_KEY` for everything.

**Rule:** Don't split a single secret into multiple env vars unless they genuinely hold different values. One key = one env var.
