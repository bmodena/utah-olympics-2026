/**
 * athletes.js - Fetch and parse athlete roster from Google Sheets or local CSV fallback.
 */
var Athletes = (function () {
  var CACHE_KEY = 'utah_olympics_athletes';

  /**
   * Parse a CSV string into an array of objects.
   * Handles quoted fields with commas and newlines.
   */
  function parseCSV(text) {
    var lines = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === '\n' && !inQuotes) {
        lines.push(current);
        current = '';
      } else if (ch === '\r' && !inQuotes) {
        // skip \r
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      lines.push(current);
    }

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
   * Normalize a parsed row into a standard athlete object.
   * Handles columns: Sport, Athlete (or name), Discipline, Country, Connection, isParkCity, Program.
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
      program: row.program || ''
    };
  }

  /**
   * Fetch athletes from Google Sheets (published as CSV).
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
        return rows.map(normalizeAthlete).filter(function (a) { return a.name; });
      });
  }

  /**
   * Fetch athletes from local CSV fallback.
   */
  function fetchFromLocal(path) {
    return fetch(path)
      .then(function (res) {
        if (!res.ok) throw new Error('Local CSV fetch failed: ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var rows = parseCSV(text);
        return rows.map(normalizeAthlete).filter(function (a) { return a.name; });
      });
  }

  /**
   * Main entry: try Google Sheet first, fall back to local CSV.
   * Caches result in sessionStorage.
   */
  function fetchAthletes() {
    // Check cache
    try {
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        return Promise.resolve(JSON.parse(cached));
      }
    } catch (e) { /* ignore */ }

    var sheetId = CONFIG.GOOGLE_SHEET_ID;
    var promise;

    if (sheetId) {
      promise = fetchFromSheet(sheetId).catch(function (err) {
        console.warn('Google Sheet failed, using local fallback:', err.message);
        return fetchFromLocal(CONFIG.FALLBACK_ATHLETES);
      });
    } else {
      promise = fetchFromLocal(CONFIG.FALLBACK_ATHLETES);
    }

    return promise.then(function (athletes) {
      // Cache
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(athletes));
      } catch (e) { /* ignore */ }
      return athletes;
    });
  }

  return {
    fetchAthletes: fetchAthletes,
    parseCSV: parseCSV
  };
})();
