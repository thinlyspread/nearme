/**
 * build.js
 * --------
 * Simple build script run by Vercel at deploy time.
 *
 * Reads public/index.html, replaces key placeholders with
 * values from environment variables, and writes the result
 * to dist/index.html for Vercel to serve.
 *
 * Environment variables required (set in Vercel dashboard):
 *   GOOGLE_API_KEY  — Google Cloud API key (Maps, Vision, Geocoding)
 */

const fs   = require('fs');
const path = require('path');

// Validate required env vars
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error('ERROR: GOOGLE_API_KEY environment variable is not set.');
  process.exit(1);
}

// Read source HTML
const srcPath = path.join(__dirname, 'public', 'index.html');
let html = fs.readFileSync(srcPath, 'utf8');

// Replace placeholders
// GOOGLE_API_KEY_HERE appears twice: once in the <script src> tag,
// once in CONFIG inside the <script> block.
html = html.replaceAll('GOOGLE_API_KEY_HERE', GOOGLE_API_KEY);

// Write to dist/
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');
console.log('Built dist/index.html with API key injected');
