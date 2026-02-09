/**
 * results.js — Fetch athlete results from a Google Sheet tab and merge
 * into schedule events for display.
 *
 * Data flow:
 *   1. Check localStorage cache (30-min TTL)
 *   2. If stale → fetch "Results" tab from Google Sheets (published as CSV)
 *   3. If Google Sheets fails → fall back to local data/results.json
 *   4. Parse CSV rows → group by event ID → build results map
 *   5. Merge results into matched schedule events
 *
 * The Google Sheet "Results" tab must have these columns:
 *   Event ID, Sport, Event, Date, Athlete, Result
 *
 * Result values: "Gold", "Silver", "Bronze", or freeform ("12th", "DNF", etc.)
 *
 * Uses the same parseCSV() from Athletes module.
 *
 * @module Results
 */
var Results = (function () {

  var CACHE_KEY = 'utah_olympics_results_v2';
  var CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  /** @type {Object|null} Parsed results keyed by event ID */
  var _resultsData = null;

  /**
   * Parse CSV rows into the internal results structure.
   * Groups rows by event ID, with athletes nested inside.
   *
   * @param {Object[]} rows - Parsed CSV rows (lowercase keys)
   * @returns {Object} { results: { eventId: { sport, event, date, athletes: { name: result } } } }
   */
  function rowsToResults(rows) {
    var results = {};

    rows.forEach(function (row) {
      var eventId = (row['event id'] || row['eventid'] || row['id'] || '').trim();
      var athlete = (row['athlete'] || row['name'] || '').trim();
      var result = (row['result'] || row['placement'] || '').trim();

      if (!eventId || !athlete || !result) return;

      if (!results[eventId]) {
        results[eventId] = {
          sport: (row['sport'] || '').trim(),
          event: (row['event'] || '').trim(),
          date: (row['date'] || '').trim(),
          athletes: {}
        };
      }

      results[eventId].athletes[athlete] = result;
    });

    return { results: results };
  }

  /**
   * Fetch results from the Google Sheet "Results" tab.
   * @returns {Promise<Object>} Parsed results data
   */
  function fetchFromSheet() {
    var gid = CONFIG.RESULTS_SHEET_GID;
    if (!gid) return Promise.reject(new Error('No RESULTS_SHEET_GID configured'));

    var url = 'https://docs.google.com/spreadsheets/d/' +
      CONFIG.GOOGLE_SHEET_ID + '/export?format=csv&gid=' + gid;

    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Sheet fetch failed: ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = Athletes.parseCSV(text);
        return rowsToResults(rows);
      });
  }

  /**
   * Fetch results from local JSON fallback.
   * @returns {Promise<Object>} Parsed results data
   */
  function fetchFromFallback() {
    return fetch(CONFIG.RESULTS_FALLBACK + '?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('Fallback fetch failed: ' + res.status);
        return res.json();
      });
  }

  /**
   * Main entry point: fetch results with caching.
   * Tries Google Sheet first, falls back to local JSON.
   * @returns {Promise<Object>} The results data object
   */
  function fetchResults() {
    var bypassCache = window.location.search.indexOf('refresh') !== -1;

    if (!bypassCache) {
      try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          var parsed = JSON.parse(cached);
          if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL) {
            _resultsData = parsed.data;
            return Promise.resolve(_resultsData);
          }
        }
      } catch (e) {
        // ignore cache errors
      }
    }

    return fetchFromSheet()
      .catch(function (err) {
        console.warn('Results sheet failed, using fallback:', err.message);
        return fetchFromFallback();
      })
      .then(function (data) {
        _resultsData = data;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
        } catch (e) {
          // ignore storage errors
        }
        return data;
      })
      .catch(function () {
        _resultsData = { results: {} };
        return _resultsData;
      });
  }

  /**
   * Attach .results property to matched events by event ID.
   * @param {Object[]} events - Array of matched schedule events
   * @param {Object} resultsData - The fetched results data
   */
  function mergeResults(events, resultsData) {
    if (!resultsData || !resultsData.results) return;
    var results = resultsData.results;

    events.forEach(function (evt) {
      if (evt.id && results[evt.id]) {
        evt.results = results[evt.id].athletes || {};
      }
    });
  }

  /**
   * Get total medal counts across all results.
   * @returns {{ gold: number, silver: number, bronze: number }}
   */
  function getMedalCounts() {
    var counts = { gold: 0, silver: 0, bronze: 0 };
    if (!_resultsData || !_resultsData.results) return counts;

    var results = _resultsData.results;
    Object.keys(results).forEach(function (eventId) {
      var athletes = results[eventId].athletes || {};
      Object.keys(athletes).forEach(function (name) {
        var val = (athletes[name] || '').toLowerCase();
        if (val === 'gold') counts.gold++;
        else if (val === 'silver') counts.silver++;
        else if (val === 'bronze') counts.bronze++;
      });
    });

    return counts;
  }

  /**
   * Get all results grouped by medal type.
   * @returns {{ gold: Array, silver: Array, bronze: Array, other: Array }}
   */
  function getAllResults() {
    var grouped = { gold: [], silver: [], bronze: [], other: [] };
    if (!_resultsData || !_resultsData.results) return grouped;

    var results = _resultsData.results;
    Object.keys(results).forEach(function (eventId) {
      var entry = results[eventId];
      var athletes = entry.athletes || {};
      Object.keys(athletes).forEach(function (name) {
        var val = athletes[name] || '';
        var item = {
          athlete: name,
          sport: entry.sport || '',
          event: entry.event || '',
          date: entry.date || '',
          result: val
        };
        var lower = val.toLowerCase();
        if (lower === 'gold') grouped.gold.push(item);
        else if (lower === 'silver') grouped.silver.push(item);
        else if (lower === 'bronze') grouped.bronze.push(item);
        else grouped.other.push(item);
      });
    });

    return grouped;
  }

  return {
    fetchResults: fetchResults,
    mergeResults: mergeResults,
    getMedalCounts: getMedalCounts,
    getAllResults: getAllResults
  };

})();
