/**
 * config.js — Global configuration for the Park City Olympics 2026 tracker.
 *
 * This file defines all external service credentials, data paths, and
 * runtime settings used across the application. It is loaded first
 * (before athletes.js, schedule.js, and app.js) and exposes a single
 * global `CONFIG` object.
 *
 * To set up a new environment:
 *   1. Get a RapidAPI key from https://rapidapi.com/jxancestral17/api/milano-cortina-2026-olympics-api
 *   2. Create a Google Sheet from data/athletes-seed.csv, publish as CSV
 *   3. Paste the Sheet ID below
 *
 * @global
 * @type {Object}
 */
var CONFIG = {

  /**
   * RapidAPI key for the Milano Cortina 2026 Olympics schedule API.
   * Used by schedule.js to fetch event data.
   * Sign up: https://rapidapi.com/jxancestral17/api/milano-cortina-2026-olympics-api
   * @type {string}
   */
  RAPIDAPI_KEY: 'a8802497fbmsh86e64da398fd5eap1e55d0jsn0efa500fb258',

  /**
   * RapidAPI host header value for the schedule API.
   * @type {string}
   */
  RAPIDAPI_HOST: 'milano-cortina-2026-olympics-api.p.rapidapi.com',

  /**
   * Google Sheet ID for the athlete roster (published to web as CSV).
   * The Sheet ID is the long string in the Google Sheets URL between /d/ and /edit.
   * athletes.js fetches this sheet first, falling back to FALLBACK_ATHLETES on failure.
   * @type {string}
   */
  GOOGLE_SHEET_ID: '1BSpyuxCaGM9kGMqT7Lrrx84LC3iRhglmA77Pe1q97eQ',

  /**
   * Local CSV file path used when Google Sheets is unavailable.
   * Must contain columns: Sport, Athlete, Discipline, Country, Connection,
   * isParkCity, Program, Status, Gender, Events
   * @type {string}
   */
  FALLBACK_ATHLETES: 'data/athletes-full.csv',

  /**
   * Path to the broadcast rules JSON file.
   * Defines per-sport TV networks, primetime settings, and streaming info.
   * @type {string}
   */
  BROADCAST_DATA: 'data/broadcast.json',

  /**
   * Canonical site URL used for share links and Open Graph tags.
   * @type {string}
   */
  SITE_URL: 'https://utah2026.townlift.com',

  /**
   * User's timezone (auto-detected via Intl API).
   * Used for display purposes; CET-to-local conversion happens in app.js.
   * @type {string}
   */
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone
};
