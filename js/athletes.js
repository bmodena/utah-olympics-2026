/**
 * athletes.js — Fetch and parse the Park City athlete roster.
 *
 * Data flow:
 *   1. Check localStorage cache (1-hour TTL)
 *   2. If stale/missing → fetch from Google Sheets (published as CSV)
 *   3. If Google Sheets fails → fall back to local data/athletes-full.csv
 *   4. Parse CSV → normalize into athlete objects → filter to active only
 *   5. Cache result in localStorage for next load
 *
 * The CSV must have these columns (case-insensitive):
 *   Sport, Athlete (or Name), Discipline, Country, Connection, isParkCity,
 *   Program, Status, Gender, Events
 *
 * The "Events" column is semicolon-delimited (e.g., "Downhill;Super-G") and
 * is used by schedule.js to match athletes to specific event disciplines.
 *
 * Exposes: Athletes.fetchAthletes(), Athletes.parseCSV()
 *
 * @module Athletes
 */
var Athletes = (function () {

  /** @type {string} localStorage key for cached athlete data */
  var CACHE_KEY = 'utah_olympics_athletes_v5';

  /** @type {number} Cache time-to-live: 1 hour in milliseconds */
  var CACHE_TTL = 60 * 60 * 1000;

  /**
   * Check if the URL contains ?refresh to force a cache bypass.
   * @returns {boolean}
   */
  function forceRefresh() {
    return window.location.search.indexOf('refresh') !== -1;
  }

  /**
   * Parse a CSV string into an array of row objects.
   * Handles RFC 4180 edge cases: quoted fields containing commas,
   * newlines inside quotes, and escaped double-quotes ("").
   *
   * @param {string} text - Raw CSV text
   * @returns {Object[]} Array of objects keyed by lowercase header names
   */
  function parseCSV(text) {
    var lines = [];
    var current = '';
    var inQuotes = false;

    // Split text into logical lines (respecting quoted newlines)
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          // Escaped double-quote inside a quoted field
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === '\n' && !inQuotes) {
        lines.push(current);
        current = '';
      } else if (ch === '\r' && !inQuotes) {
        // Skip carriage returns (Windows line endings)
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      lines.push(current);
    }

    // Need at least a header row + one data row
    if (lines.length < 2) return [];

    var headers = splitCSVLine(lines[0]);
    var rows = [];
    for (var j = 1; j < lines.length; j++) {
      var values = splitCSVLine(lines[j]);
      if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;
      var obj = {};
      for (var k = 0; k < headers.length; k++) {
        obj[headers[k].trim().toLowerCase()] = (values[k] || '').trim();
      }
      rows.push(obj);
    }
    return rows;
  }

  /**
   * Split a single CSV line into field values.
   * Respects quoted fields containing commas.
   *
   * @param {string} line - A single logical CSV line
   * @returns {string[]} Array of field values
   */
  function splitCSVLine(line) {
    var fields = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  /**
   * Normalize a parsed CSV row into a standard athlete object.
   *
   * @param {Object} row - Raw CSV row with lowercase keys
   * @returns {Object} Normalized athlete object:
   *   - name {string}      — Athlete's full name
   *   - sport {string}     — Sport (e.g., "Freestyle Skiing")
   *   - discipline {string} — Specific discipline (e.g., "Halfpipe")
   *   - country {string}   — 3-letter country code, defaults to "USA"
   *   - utahConnection {string} — Local program/organization ties
   *   - isParkCity {boolean} — Whether athlete has a Park City connection
   *   - program {string}   — Training program name
   *   - status {string}    — "active" or "inactive"
   *   - gender {string}    — "M", "F", or "" (single character)
   *   - events {string[]}  — List of event disciplines (from semicolon-delimited column)
   */
  function normalizeAthlete(row) {
    return {
      name: row.name || row.athlete || '',
      sport: row.sport || '',
      discipline: row.discipline || '',
      country: row.country || 'USA',
      utahConnection: row.utahconnection || row.connection || row.program || '',
      isParkCity: row.isparkcity
        ? row.isparkcity.toUpperCase() === 'TRUE'
        : false,
      program: row.program || '',
      status: (row.status || 'active').toLowerCase().trim(),
      gender: (row.gender || '').toUpperCase().trim().charAt(0) || '',
      events: (row.events || '').split(';').map(function (e) { return e.trim(); }).filter(Boolean)
    };
  }

  /**
   * Fetch athletes from a published Google Sheet (exported as CSV).
   *
   * @param {string} sheetId - The Google Sheet document ID
   * @returns {Promise<Object[]>} Resolved with array of active athlete objects
   */
  function fetchFromSheet(sheetId) {
    var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv';
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Google Sheet fetch failed: ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);
        return rows.map(normalizeAthlete).filter(function (a) { return a.name && a.status === 'active'; });
      });
  }

  /**
   * Fetch athletes from a local CSV file (fallback when Sheets is unavailable).
   *
   * @param {string} path - Relative path to the CSV file
   * @returns {Promise<Object[]>} Resolved with array of active athlete objects
   */
  function fetchFromLocal(path) {
    return fetch(path)
      .then(function (res) {
        if (!res.ok) throw new Error('Local CSV fetch failed: ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);
        return rows.map(normalizeAthlete).filter(function (a) { return a.name && a.status === 'active'; });
      });
  }

  /**
   * Main entry point: fetch the athlete roster with caching.
   *
   * Strategy:
   *   1. Return cached data if within TTL (1 hour)
   *   2. Try Google Sheets (live, editable by content team)
   *   3. Fall back to local CSV on failure
   *   4. Cache the result in localStorage
   *
   * Append ?refresh to the URL to force a cache bypass.
   *
   * @returns {Promise<Object[]>} Array of normalized, active athlete objects
   */
  function fetchAthletes() {
    // Check localStorage cache
    if (!forceRefresh()) {
      try {
        var raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          var cached = JSON.parse(raw);
          if (Date.now() - cached.timestamp < CACHE_TTL) {
            return Promise.resolve(cached.data);
          }
        }
      } catch (e) { /* ignore corrupt cache */ }
    }

    var sheetId = CONFIG.GOOGLE_SHEET_ID;
    var promise;

    if (sheetId) {
      // Try live Google Sheet first, fall back to local CSV
      promise = fetchFromSheet(sheetId).catch(function (err) {
        console.warn('Google Sheet failed, using local fallback:', err.message);
        return fetchFromLocal(CONFIG.FALLBACK_ATHLETES);
      });
    } else {
      promise = fetchFromLocal(CONFIG.FALLBACK_ATHLETES);
    }

    return promise.then(function (athletes) {
      // Cache with timestamp for TTL checks
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          timestamp: Date.now(),
          data: athletes
        }));
      } catch (e) { /* ignore localStorage quota errors */ }
      return athletes;
    });
  }

  // Public API
  return {
    fetchAthletes: fetchAthletes,
    parseCSV: parseCSV
  };
})();
