/**
 * Configuration for Utah Olympics 2026 app.
 * Fill in your own API key and Google Sheet ID below.
 */
var CONFIG = {
  // RapidAPI key for Milano Cortina 2026 Olympics API
  // Sign up at: https://rapidapi.com/jxancestral17/api/milano-cortina-2026-olympics-api
  RAPIDAPI_KEY: 'a8802497fbmsh86e64da398fd5eap1e55d0jsn0efa500fb258',

  // RapidAPI host
  RAPIDAPI_HOST: 'milano-cortina-2026-olympics-api.p.rapidapi.com',

  // Google Sheet ID for athlete roster
  // Create a Google Sheet, import data/athletes-seed.csv, publish to web as CSV
  // The Sheet ID is the long string in the Google Sheets URL between /d/ and /edit
  GOOGLE_SHEET_ID: '1BSpyuxCaGM9kGMqT7Lrrx84LC3iRhglmA77Pe1q97eQ',

  // Paths
  FALLBACK_ATHLETES: 'data/athletes-full.csv',
  BROADCAST_DATA: 'data/broadcast.json',

  // Site URL
  SITE_URL: 'https://utah2026.townlift.com',

  // Timezone display (auto-detected, but can be overridden)
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone
};
