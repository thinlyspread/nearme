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
