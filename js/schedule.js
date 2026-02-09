/**
 * schedule.js — Fetch the Milano Cortina 2026 schedule from RapidAPI,
 * normalize events, apply broadcast rules, and match to Park City athletes.
 *
 * Data flow:
 *   1. Check localStorage cache (30min during Olympics, 24h otherwise)
 *   2. If stale → fetch from RapidAPI /events endpoint
 *   3. Normalize API response:
 *      a. Map API sport codes to display names
 *      b. Reclassify ~38 "unknown" events using venue/discipline heuristics
 *      c. Fix snowboard events the API labels as "Freestyle Skiing"
 *      d. Clean embedded venue names from discipline text
 *      e. Detect event gender (Men's/Women's/Mixed) from raw text
 *      f. Filter to medal events only
 *   4. Fetch broadcast rules from data/broadcast.json
 *   5. Apply per-sport TV networks, NBC primetime, and Peacock streaming
 *   6. Match events to athletes by sport, gender, and event discipline
 *
 * Known API quirks:
 *   - ~38 events come back with sport="unknown" (luge, skeleton, short track,
 *     figure skating, etc.) — classifyUnknownEvent() handles these
 *   - Some snowboard events are labeled "freestyle_skiing" by the API
 *   - Venue info is sometimes null, with venue name embedded in discipline text
 *   - Discipline text includes "Medal Event" and venue names concatenated
 *   - API returns 127 medal events vs 116 official (sub-rounds counted separately)
 *   - Ski Mountaineering (new for 2026) is absent from the API entirely
 *
 * Exposes: Schedule.fetchSchedule(), Schedule.matchScheduleToAthletes(),
 *          Schedule.normalizeSport()
 *
 * @module Schedule
 */
var Schedule = (function () {

  /** @type {string} localStorage key for cached schedule */
  var SCHEDULE_CACHE_KEY = 'utah_olympics_schedule_v1';

  /** @type {string} localStorage key for cached broadcast rules */
  var BROADCAST_CACHE_KEY = 'utah_olympics_broadcast_v1';

  /** @type {string} localStorage key for API refresh throttle timestamp */
  var REFRESH_THROTTLE_KEY = 'utah_olympics_refresh_throttle';

  /**
   * Cache TTL: how long localStorage data is considered "fresh" before
   * we attempt a background API refresh.
   *
   * 30 minutes during the Olympic competition window (Feb 6–22, 2026)
   * keeps data reasonably current without hammering the API.
   * 24 hours off-season since data rarely changes.
   *
   * IMPORTANT: This TTL does NOT block page load. The page always renders
   * immediately from cache or static fallback. Stale cache only triggers a
   * background API call (subject to the 1-hour refresh throttle).
   *
   * @returns {number} TTL in milliseconds
   */
  function getCacheTTL() {
    var now = new Date();
    var start = new Date('2026-02-06T00:00:00');
    var end = new Date('2026-02-23T00:00:00');
    if (now >= start && now <= end) return 30 * 60 * 1000; // 30 minutes
    return 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Check whether we're allowed to make an API call right now.
   * Returns true if enough time has passed since the last API attempt.
   *
   * Throttle window: 1 hour during Olympics, 24 hours off-season.
   * This is separate from the cache TTL — even if data is "stale",
   * we won't hit the API more than once per throttle window.
   *
   * @returns {boolean} true if an API call is allowed
   */
  function canRefreshAPI() {
    if (forceRefresh()) return true;
    try {
      var last = localStorage.getItem(REFRESH_THROTTLE_KEY);
      if (!last) return true;
      var now = new Date();
      var start = new Date('2026-02-06T00:00:00');
      var end = new Date('2026-02-23T00:00:00');
      var throttle = (now >= start && now <= end)
        ? 60 * 60 * 1000   // 1 hour during Olympics
        : 24 * 60 * 60 * 1000; // 24 hours off-season
      return (Date.now() - parseInt(last, 10)) > throttle;
    } catch (e) { return true; }
  }

  /**
   * Record that we just attempted an API call (successful or not).
   * Resets the throttle timer.
   */
  function markRefreshAttempt() {
    try {
      localStorage.setItem(REFRESH_THROTTLE_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  /**
   * Check if ?refresh is in the URL to force bypass of all caches.
   * @returns {boolean}
   */
  function forceRefresh() {
    return window.location.search.indexOf('refresh') !== -1;
  }

  /**
   * Read cached data from localStorage if still within TTL.
   * @param {string} key - localStorage key
   * @returns {*|null} Cached data or null if expired/missing
   */
  function getCache(key) {
    if (forceRefresh()) return null;
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp > getCacheTTL()) return null;
      return cached.data;
    } catch (e) { return null; }
  }

  /**
   * Write data to localStorage with a timestamp for TTL checks.
   * Silently ignores quota errors.
   * @param {string} key - localStorage key
   * @param {*} data - Data to cache (must be JSON-serializable)
   */
  function setCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) { /* ignore quota errors */ }
  }

  // =====================================================================
  // API Fetching
  // =====================================================================

  /**
   * Fetch raw schedule data from the RapidAPI Milano Cortina 2026 endpoint.
   * Falls back to local data/schedule-cache.json if the API is unavailable
   * (rate-limited, down, etc.).
   *
   * @param {string} apiKey - RapidAPI key from CONFIG
   * @returns {Promise<Object[]>} Normalized event objects
   */
  function fetchFromAPI(apiKey) {
    var url = 'https://' + CONFIG.RAPIDAPI_HOST + '/events';
    return fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': CONFIG.RAPIDAPI_HOST
      }
    }).then(function (res) {
      if (!res.ok) throw new Error('RapidAPI fetch failed: ' + res.status);
      return res.json();
    }).then(function (data) {
      return normalizeAPIData(data);
    }).catch(function (err) {
      console.warn('RapidAPI failed (' + err.message + '), using local schedule fallback');
      return fetchLocalSchedule();
    });
  }

  /**
   * Fetch schedule from the local static JSON fallback file.
   * Used when the RapidAPI endpoint is rate-limited or unavailable.
   *
   * @returns {Promise<Object[]>} Normalized event objects
   */
  function fetchLocalSchedule() {
    var path = CONFIG.FALLBACK_SCHEDULE || 'data/schedule-cache.json';
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error('Local schedule fallback failed: ' + res.status);
      return res.json();
    }).then(function (data) {
      return normalizeAPIData(data);
    });
  }

  // =====================================================================
  // Sport Name Mapping
  // =====================================================================

  /**
   * Map from API snake_case sport codes to human-readable display names.
   * These 16 sports cover the full Milano Cortina 2026 program.
   * @type {Object.<string, string>}
   */
  var apiSportNames = {
    'alpine_skiing': 'Alpine Skiing',
    'biathlon': 'Biathlon',
    'bobsleigh': 'Bobsleigh',
    'cross_country_skiing': 'Cross-Country Skiing',
    'curling': 'Curling',
    'figure_skating': 'Figure Skating',
    'freestyle_skiing': 'Freestyle Skiing',
    'ice_hockey': 'Ice Hockey',
    'luge': 'Luge',
    'nordic_combined': 'Nordic Combined',
    'short_track': 'Short Track Speed Skating',
    'skeleton': 'Skeleton',
    'ski_jumping': 'Ski Jumping',
    'ski_mountaineering': 'Ski Mountaineering',
    'snowboarding': 'Snowboard',
    'speed_skating': 'Speed Skating'
  };

  /**
   * Convert an API sport code to its display name.
   * @param {string} apiName - API sport code (e.g., "alpine_skiing")
   * @returns {string} Display name (e.g., "Alpine Skiing")
   */
  function displaySportName(apiName) {
    return apiSportNames[(apiName || '').toLowerCase()] || apiName || '';
  }

  // =====================================================================
  // Unknown Event Classification
  // =====================================================================

  /**
   * Classify events the API returns with sport="unknown".
   *
   * The API misclassifies ~38 medal events. We use venue names and
   * discipline text to determine the correct sport. Classification rules:
   *
   *   Cortina Sliding Centre → Luge (singles/doubles/relay) or Skeleton (heats)
   *   Milano Ice Skating Arena / PalaSharp → Figure Skating or Short Track
   *   Discipline contains "aerials/moguls/freeski/ski cross" → Freestyle Skiing
   *   Discipline contains "Stelvio/combined" → Alpine Skiing
   *   Discipline contains "medal game/semi-final" → Ice Hockey
   *
   * @param {Object} e - Raw API event object
   * @returns {string} Corrected sport display name, or '' if unclassifiable
   */
  function classifyUnknownEvent(e) {
    var disc = (e.discipline || '').toLowerCase();
    var venueName = (e.venue && e.venue.name) ? e.venue.name.toLowerCase() : '';

    // Cortina Sliding Centre → Luge or Skeleton
    if (venueName.indexOf('sliding') !== -1) {
      if (disc.indexOf('singles') !== -1 || disc.indexOf('doubles') !== -1 ||
          disc.indexOf('mixed team') !== -1 || disc.indexOf('team relay') !== -1) {
        return 'Luge';
      }
      if (disc.indexOf('heat') !== -1) {
        return 'Skeleton';
      }
      return 'Luge';
    }

    // Milano Ice Skating Arena / PalaSharp → Figure Skating or Short Track
    if (venueName.indexOf('ice skating') !== -1 || venueName.indexOf('palasharp') !== -1) {
      if (disc.indexOf('single skating') !== -1 || disc.indexOf('team event') !== -1 ||
          disc.indexOf('free skating') !== -1 || disc.indexOf('ice danc') !== -1 ||
          disc.indexOf('pairs') !== -1) {
        return 'Figure Skating';
      }
      return 'Short Track Speed Skating';
    }

    // Events with null venue — venue name is embedded in discipline text
    if (disc.indexOf('aerials') !== -1 || disc.indexOf('moguls') !== -1) {
      return 'Freestyle Skiing';
    }
    if (disc.indexOf('freeski') !== -1 || disc.indexOf('ski cross') !== -1) {
      return 'Freestyle Skiing';
    }
    if (disc.indexOf('slopestyle') !== -1 && disc.indexOf('livigno') !== -1) {
      return 'Freestyle Skiing';
    }
    if (disc.indexOf('stelvio') !== -1 || disc.indexOf('combined') !== -1) {
      return 'Alpine Skiing';
    }
    if (disc.indexOf('medal game') !== -1 || disc.indexOf('semi-final') !== -1) {
      return 'Ice Hockey';
    }

    return '';
  }

  // =====================================================================
  // Discipline Text Cleaning
  // =====================================================================

  /**
   * Remove embedded venue names and "Medal Event" markers from discipline text.
   *
   * The API concatenates venue names directly into the discipline field
   * (e.g., "Men's DownhillMedal EventStelvio Ski Centre"). This strips
   * those artifacts to produce clean event names for display.
   *
   * @param {string} disc - Raw discipline text from API
   * @returns {string} Cleaned discipline text
   */
  function cleanDiscipline(disc) {
    if (!disc) return '';
    return disc
      .replace(/Medal Event/g, '')
      .replace(/Livigno Aerials & Moguls Park/g, '')
      .replace(/Livigno Snow Park/g, '')
      .replace(/Stelvio Ski Centre/g, '')
      .replace(/Tofane Alpine Skiing Centre/g, '')
      .replace(/Tesero Cross-Country Skiing Stadium/g, '')
      .replace(/Predazzo Ski Jumping Stadium/g, '')
      .replace(/Cortina Sliding Centre/g, '')
      .replace(/Milano Ice Skating Arena/g, '')
      .replace(/PalaSharp/g, '')
      .trim();
  }

  // =====================================================================
  // Data Normalization
  // =====================================================================

  /**
   * Normalize the raw API response into our standard event format.
   *
   * Performs all data cleaning in a single pass:
   *   1. Classify "unknown" sports
   *   2. Build venue string from venue object or embedded text
   *   3. Clean discipline text
   *   4. Reclassify misattributed snowboard events
   *   5. Detect event gender from all available text
   *   6. Filter to medal events only (drops qualifiers, training, unknown sports)
   *
   * @param {Object|Array} data - Raw API response (array or {events: [...]})
   * @returns {Object[]} Array of normalized event objects
   */
  function normalizeAPIData(data) {
    var events = Array.isArray(data) ? data : (data.events || data.schedule || []);
    return events.map(function (e) {
      // Step 1: Determine sport — fix "unknown" classification
      var sport = e.sport;
      if (!sport || sport === 'unknown') {
        var classified = classifyUnknownEvent(e);
        sport = classified || 'unknown';
      } else {
        sport = displaySportName(sport);
      }

      // Step 2: Build venue string from structured or embedded data
      var venue = '';
      if (e.venue) {
        if (typeof e.venue === 'string') {
          venue = e.venue;
        } else {
          var parts = [];
          if (e.venue.name) parts.push(e.venue.name);
          if (e.venue.city) parts.push(e.venue.city);
          venue = parts.join(', ');
        }
      }

      // Extract venue from discipline text when venue object is empty
      if (!venue) {
        var rawDisc = e.discipline || '';
        if (rawDisc.indexOf('Livigno Aerials') !== -1) venue = 'Livigno Aerials & Moguls Park, Livigno';
        else if (rawDisc.indexOf('Livigno Snow') !== -1) venue = 'Livigno Snow Park, Livigno';
        else if (rawDisc.indexOf('Stelvio') !== -1) venue = 'Stelvio Ski Centre, Bormio';
        else if (rawDisc.indexOf('Tofane') !== -1) venue = 'Tofane Alpine Skiing Centre, Cortina';
        else if (rawDisc.indexOf('Tesero') !== -1) venue = 'Tesero Cross-Country Skiing Stadium, Tesero';
        else if (rawDisc.indexOf('Predazzo') !== -1) venue = 'Predazzo Ski Jumping Stadium, Predazzo';
      }

      // Step 3: Clean discipline text (remove embedded venues + "Medal Event")
      var cleaned = cleanDiscipline(e.discipline);

      // Step 4: Reclassify snowboard events the API misattributes to Freestyle Skiing
      var rawDiscLower = (e.discipline || '').toLowerCase();
      if (sport === 'Freestyle Skiing' && (
        rawDiscLower.indexOf('sbd ') !== -1 ||
        rawDiscLower.indexOf('pgs ') !== -1 ||
        rawDiscLower.indexOf('pgs') === 0 ||
        rawDiscLower.indexOf('snowboard') !== -1 ||
        rawDiscLower.indexOf('sbx') !== -1
      )) {
        sport = 'Snowboard';
      }

      // Step 5: Detect event gender from all raw API text before cleaning
      var genderSource = [
        e.discipline || '',
        e.event || '',
        e.eventName || '',
        e.gender || ''
      ].join(' ').toLowerCase();
      var eventGender = '';
      if (genderSource.indexOf('mixed') !== -1) {
        eventGender = '';  // Mixed events match both genders
      } else if (genderSource.indexOf('women') !== -1 || genderSource.indexOf('ladies') !== -1) {
        eventGender = 'F';
      } else if (/\bmen\b/.test(genderSource) || genderSource.indexOf("men's") !== -1 || genderSource.indexOf("men\u2019s") !== -1) {
        eventGender = 'M';
      }

      return {
        id: e.id || '',
        date: e.date || '',           // YYYY-MM-DD
        time: e.time || '',           // HH:MM in CET (UTC+1)
        sport: sport,                 // Display name (e.g., "Alpine Skiing")
        discipline: cleaned,          // Cleaned discipline text
        event: cleaned || e.event || e.eventName || '',
        venue: venue,                 // "Venue Name, City" or ""
        isMedalEvent: e.is_medal_event || false,
        status: e.status || 'upcoming',  // "upcoming" | "live" | "completed"
        eventGender: eventGender,     // "M" | "F" | ""
        broadcast: []                 // Populated later by applyBroadcastRules()
      };
    }).filter(function (e) {
      // Step 6: Only keep medal events with known sports
      return e.sport !== 'unknown' && e.isMedalEvent;
    });
  }

  // =====================================================================
  // Broadcast Rules
  // =====================================================================

  /**
   * Fetch broadcast rules from the local JSON file.
   * Returns null on failure (broadcast info is optional).
   *
   * Expected format of broadcast.json:
   *   {
   *     "streaming": { "network": "Peacock", "type": "streaming" },
   *     "sportNetworks": { "Alpine Skiing": "NBC / USA Network", ... },
   *     "medalPrimetime": { "network": "NBC", "time": "19:00" },
   *     "eventOverrides": {}
   *   }
   *
   * @returns {Promise<Object|null>}
   */
  function fetchBroadcastRules() {
    return fetch(CONFIG.BROADCAST_DATA || 'data/broadcast.json')
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .catch(function () { return null; });
  }

  /**
   * Convert a CET time string (HH:MM) to Mountain Standard Time.
   *
   * CET = UTC+1, MST = UTC-7 → offset is -8 hours.
   * February has no DST transition in either timezone, so a simple
   * arithmetic offset is safe for the entire competition window.
   *
   * @param {string} timeStr - Time in "HH:MM" CET format
   * @returns {string} Time in "HH:MM" MST format, or '' if invalid
   */
  function cetToMountain(timeStr) {
    if (!timeStr) return '';
    var parts = timeStr.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1] || '00';
    if (isNaN(h)) return '';
    h -= 8;
    if (h < 0) h += 24;
    return (h < 10 ? '0' : '') + h + ':' + m;
  }

  /**
   * Enrich events with broadcast information based on rules from broadcast.json.
   *
   * Each event gets up to 3 broadcast entries:
   *   1. Sport-specific live TV network (e.g., "NBC / USA Network")
   *   2. NBC primetime for medal events (at 7:00 PM MT)
   *   3. Peacock streaming (always available)
   *
   * Event-specific overrides (eventOverrides) take precedence over rules.
   *
   * @param {Object[]} events - Normalized event objects
   * @param {Object|null} rules - Broadcast rules from broadcast.json
   * @returns {Object[]} Events with broadcast arrays populated
   */
  function applyBroadcastRules(events, rules) {
    if (!rules) return events;
    return events.map(function (evt) {
      // Check for event-specific overrides first
      if (rules.eventOverrides && rules.eventOverrides[evt.id]) {
        var overrides = rules.eventOverrides[evt.id];
        return assign(evt, { broadcast: overrides });
      }

      var broadcasts = [];

      // Sport-specific live TV network
      var sportNet = rules.sportNetworks && rules.sportNetworks[evt.sport];
      if (sportNet) {
        broadcasts.push({
          network: sportNet,
          type: 'live',
          time: cetToMountain(evt.time)  // Convert CET event time to MT for display
        });
      }

      // NBC primetime for medal events
      if (evt.isMedalEvent && rules.medalPrimetime) {
        broadcasts.push({
          network: rules.medalPrimetime.network,
          type: 'primetime',
          time: rules.medalPrimetime.time  // Already in MT (e.g., "19:00")
        });
      }

      // Peacock streaming (always available for all events)
      if (rules.streaming) {
        broadcasts.push({
          network: rules.streaming.network,
          type: rules.streaming.type || 'streaming'
        });
      }

      return assign(evt, { broadcast: broadcasts });
    });
  }

  /**
   * Simple Object.assign polyfill for older browsers.
   * Creates a new object merging all properties from the arguments.
   *
   * @param {Object} target - Base object
   * @param {...Object} sources - Source objects to merge in
   * @returns {Object} New merged object (target is not mutated)
   */
  function assign(target) {
    var result = {};
    for (var k in target) {
      if (target.hasOwnProperty(k)) result[k] = target[k];
    }
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      for (var k2 in src) {
        if (src.hasOwnProperty(k2)) result[k2] = src[k2];
      }
    }
    return result;
  }

  // =====================================================================
  // Main Fetch Entry Point
  // =====================================================================

  /**
   * Read cached data from localStorage, returning it even if stale.
   * Returns { data, isStale } so the caller can decide whether to refresh.
   *
   * @param {string} key - localStorage key
   * @returns {{ data: *, isStale: boolean } | null}
   */
  function getCacheWithAge(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (!cached.data) return null;
      var isStale = (Date.now() - cached.timestamp) > getCacheTTL();
      return { data: cached.data, isStale: isStale };
    } catch (e) { return null; }
  }

  /**
   * Main entry: fetch schedule and apply broadcast rules.
   *
   * Strategy (designed to minimize API calls under high traffic):
   *
   *   1. FRESH CACHE (< 30min) → serve immediately, no API call at all
   *   2. STALE CACHE → serve immediately, kick off background API refresh
   *      for the next page load (throttled to once per hour max)
   *   3. NO CACHE → load from static data/schedule-cache.json (instant,
   *      no API call), then kick off background refresh (throttled)
   *
   * The API is NEVER called synchronously in the page load path when cache
   * exists. This means even if the API is rate-limited or down, the page
   * always loads with data.
   *
   * Append ?refresh to the URL to force a synchronous API fetch.
   *
   * @returns {Promise<Object[]>} Array of normalized events with broadcast info
   */
  function fetchSchedule() {
    var apiKey = CONFIG.RAPIDAPI_KEY;

    // Broadcast rules (small, rarely changes — simple cache-or-fetch)
    var cachedBroadcast = getCache(BROADCAST_CACHE_KEY);
    var broadcastPromise = cachedBroadcast
      ? Promise.resolve(cachedBroadcast)
      : fetchBroadcastRules().then(function (rules) {
          if (rules) setCache(BROADCAST_CACHE_KEY, rules);
          return rules;
        });

    // ?refresh forces a live API fetch (bypasses all caches)
    if (forceRefresh() && apiKey) {
      return Promise.all([
        fetchFromAPI(apiKey).then(function (events) {
          setCache(SCHEDULE_CACHE_KEY, events);
          return events;
        }),
        broadcastPromise
      ]).then(function (results) {
        return applyBroadcastRules(results[0], results[1]);
      });
    }

    // Check localStorage cache (returns data even if stale)
    var cached = getCacheWithAge(SCHEDULE_CACHE_KEY);

    if (cached && !cached.isStale) {
      // FRESH CACHE: serve immediately, zero API calls
      return broadcastPromise.then(function (rules) {
        return applyBroadcastRules(cached.data, rules);
      });
    }

    if (cached && cached.isStale) {
      // STALE CACHE: serve immediately, refresh in background for next load
      if (apiKey) {
        backgroundRefresh(apiKey);
      }
      return broadcastPromise.then(function (rules) {
        return applyBroadcastRules(cached.data, rules);
      });
    }

    // NO CACHE: load from static fallback file (instant, no API call)
    var schedulePromise = fetchLocalSchedule().then(function (events) {
      setCache(SCHEDULE_CACHE_KEY, events);
      return events;
    });

    // Kick off background API refresh so next load has fresh data
    if (apiKey) {
      backgroundRefresh(apiKey);
    }

    return Promise.all([schedulePromise, broadcastPromise]).then(function (results) {
      return applyBroadcastRules(results[0], results[1]);
    });
  }

  /**
   * Silently fetch fresh data from the API and update localStorage.
   * Runs in the background — does not block page rendering.
   * Failures are silently ignored (cached/static data is already showing).
   *
   * @param {string} apiKey - RapidAPI key
   */
  function backgroundRefresh(apiKey) {
    // Throttle: only allow one API call per hour (during Olympics)
    if (!canRefreshAPI()) return;
    markRefreshAttempt();

    setTimeout(function () {
      var url = 'https://' + CONFIG.RAPIDAPI_HOST + '/events';
      fetch(url, {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': CONFIG.RAPIDAPI_HOST
        }
      }).then(function (res) {
        if (!res.ok) return;
        return res.json();
      }).then(function (data) {
        if (data) {
          var events = normalizeAPIData(data);
          if (events.length > 0) {
            setCache(SCHEDULE_CACHE_KEY, events);
          }
        }
      }).catch(function () {
        // Silently ignore — user already has data showing
      });
    }, 2000); // Delay 2s so it doesn't compete with initial render
  }

  // =====================================================================
  // Athlete-to-Event Matching
  // =====================================================================

  /**
   * Sport name normalization map.
   * Maps various athlete CSV sport names to canonical lowercase keys
   * for matching against schedule event sport names.
   * @type {Object.<string, string>}
   */
  var sportAliases = {
    'alpine skiing': 'alpine skiing',
    'biathlon': 'biathlon',
    'bobsleigh': 'bobsleigh',
    'bobsled': 'bobsleigh',
    'cross-country skiing': 'cross-country skiing',
    'cross country skiing': 'cross-country skiing',
    'curling': 'curling',
    'figure skating': 'figure skating',
    'freestyle skiing': 'freestyle skiing',
    'freestyle aerials': 'freestyle skiing',
    'freestyle moguls': 'freestyle skiing',
    'freeski halfpipe': 'freestyle skiing',
    'freeski slopestyle & big air': 'freestyle skiing',
    'freeski slopestyle': 'freestyle skiing',
    'freeski big air': 'freestyle skiing',
    'ice hockey': 'ice hockey',
    'luge': 'luge',
    'nordic combined': 'nordic combined',
    'short track speed skating': 'short track speed skating',
    'short track': 'short track speed skating',
    'skeleton': 'skeleton',
    'ski jumping': 'ski jumping',
    'snowboard': 'snowboard',
    'snowboarding': 'snowboard',
    'snowboard cross': 'snowboard',
    'snowboard halfpipe': 'snowboard',
    'snowboard slopestyle': 'snowboard',
    'snowboard big air': 'snowboard',
    'snowboard parallel giant slalom': 'snowboard',
    'speed skating': 'speed skating'
  };

  /**
   * Event alias map: maps athlete CSV Event column values to text patterns
   * found in the API's discipline/event fields.
   *
   * Needed because the API uses abbreviations (e.g., "4-man" for "Four-Man",
   * "PGS" for "Parallel Giant Slalom", "SBX" for "Snowboard Cross").
   *
   * @type {Object.<string, string[]>}
   */
  var eventAliases = {
    'four-man': ['4-man'],
    'two-man': ['2-man'],
    'pairs': ['pair skating', 'pairs'],
    'team event': ['team event'],
    'single skating': ['single skating'],
    'big air': ['big air', ' ba '],
    'halfpipe': ['halfpipe', ' hp '],
    'slopestyle': ['slopestyle'],
    'parallel giant slalom': ['pgs', 'parallel giant slalom'],
    'snowboard cross': ['snowboard cross', 'sbx', 'sbd cross'],
    'skeleton': ['skeleton', 'heat'],
    'individual': ['individual', 'ind.']
  };

  /**
   * Normalize a sport name to its canonical form for matching.
   * @param {string} name - Sport name from any source
   * @returns {string} Lowercase canonical sport name
   */
  function normalizeSport(name) {
    if (!name) return '';
    var lower = name.toLowerCase().trim();
    return sportAliases[lower] || lower;
  }

  /**
   * Check if an athlete's event discipline matches the schedule event text.
   * First tries direct substring match, then checks aliases.
   *
   * @param {string} athleteEvent - Event name from athlete CSV (e.g., "Downhill")
   * @param {string} evtText - Combined discipline + event text from API (lowercased, padded)
   * @returns {boolean} True if the athlete competes in this event
   */
  function eventMatches(athleteEvent, evtText) {
    var ev = athleteEvent.toLowerCase();
    // Direct substring match
    if (evtText.indexOf(ev) !== -1) return true;
    // Check aliases for API abbreviation differences
    var aliases = eventAliases[ev];
    if (aliases) {
      return aliases.some(function (a) {
        return evtText.indexOf(a) !== -1;
      });
    }
    return false;
  }

  /**
   * Match schedule events to the athlete roster.
   *
   * Algorithm:
   *   1. Index athletes by normalized sport name
   *   2. For each event, find athletes in the same sport
   *   3. Filter by gender if the event specifies Men's or Women's
   *   4. Strict-match against athlete's Events column using eventAliases
   *   5. Only return events that matched at least one athlete
   *
   * @param {Object[]} schedule - Normalized events from fetchSchedule()
   * @param {Object[]} athletes - Normalized athletes from Athletes.fetchAthletes()
   * @returns {Object[]} Events with matched athletes array attached
   */
  function matchScheduleToAthletes(schedule, athletes) {
    // Build a lookup: sport → [athletes]
    var sportMap = {};
    athletes.forEach(function (ath) {
      var key = normalizeSport(ath.sport);
      if (!sportMap[key]) sportMap[key] = [];
      sportMap[key].push(ath);
    });

    return schedule.map(function (evt) {
      var eventSport = normalizeSport(evt.sport);
      var matched = sportMap[eventSport] || [];

      // Gender filter: Men's events → male athletes only, Women's → female only
      if (evt.eventGender && matched.length > 0) {
        matched = matched.filter(function (ath) {
          return !ath.gender || ath.gender === evt.eventGender;
        });
      }

      // Strict event discipline matching using athlete Events column
      if (matched.length > 0) {
        var evtDisc = (evt.discipline || '').toLowerCase().trim();
        var evtEvent = (evt.event || '').toLowerCase().trim();
        var evtText = ' ' + evtDisc + ' ' + evtEvent + ' ';  // Padded for boundary matching

        matched = matched.filter(function (ath) {
          if (ath.events && ath.events.length > 0) {
            return ath.events.some(function (ev) {
              return eventMatches(ev, evtText);
            });
          }
          // Athletes with no events defined are included as fallback
          return true;
        });
      }

      return {
        id: evt.id || '',
        date: evt.date,
        time: evt.time,
        sport: evt.sport,
        discipline: evt.discipline,
        event: evt.event,
        venue: evt.venue,
        isMedalEvent: evt.isMedalEvent || false,
        status: evt.status || 'upcoming',
        eventGender: evt.eventGender || '',
        broadcast: evt.broadcast || [],
        athletes: matched
      };
    }).filter(function (evt) {
      // Only show events where at least one Park City athlete is competing
      return evt.athletes.length > 0;
    });
  }

  // Public API
  return {
    fetchSchedule: fetchSchedule,
    matchScheduleToAthletes: matchScheduleToAthletes,
    normalizeSport: normalizeSport
  };
})();
