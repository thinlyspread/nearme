# NearMe — Lessons Learned

> For cross-game platform/tooling lessons (Vercel, git workflows, env vars, API rules), see the [**playbook**](https://github.com/Pegsy-Games/playbook/blob/main/LESSONS_LEARNED.md). This file is NearMe-specific only.

---

## Cloud Vision + Street View URLs

- Cloud Vision `imageUri` **cannot** fetch Google Street View Static API URLs
- Likely cause: API key has domain/referrer restrictions; Vision servers don't match
- **Always use base64**: fetch image → FileReader → base64 → Vision `content` field
- Slower per image but reliable. Parallel batching (v0.3.0) offsets the cost

See the cross-game rule ["Don't assume third-party API behaviour"](https://github.com/Pegsy-Games/playbook/blob/main/LESSONS_LEARNED.md) for the general principle.

---

## Vision API route must always use base64

**History:** During the v0.4.0 migration, the Vision API route was written using `imageUri` again — the same approach that broke v0.3.0. Same symptom: new locations failed with "No usable Street View images found"; cached locations worked fine.

**Fix:** The Vision API route fetches the Street View image server-side and converts to base64 before calling Vision. This is enforced in `src/app/api/vision/route.js`. Better than client-side base64 because the image never transits through the browser.

---

## Supabase RLS + anon writes on `location_library`

- By default, RLS blocks anon inserts
- Current temporary policy: `"Anon insert (temporary)"` on `location_library` table
- **TODO (Phase 3):** Move location saving to a Vercel Edge Function using the service role key, then remove the anon insert policy
