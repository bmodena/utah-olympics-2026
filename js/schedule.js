/**
 * schedule.js - Fetch schedule from RapidAPI or static JSON fallback,
 * then match events to Utah athletes.
 */
var Schedule = (function () {

  /**
   * Fetch schedule from RapidAPI.
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
    });
  }

  /**
   * Fetch schedule from static JSON fallback.
   */
  function fetchFromLocal(path) {
    return fetch(path)
      .then(function (res) {
        if (!res.ok) throw new Error('Local schedule fetch failed: ' + res.status);
        return res.json();
      });
  }

  /**
   * Convert API sport name (e.g. "alpine_skiing") to display name ("Alpine Skiing").
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

  function displaySportName(apiName) {
    return apiSportNames[(apiName || '').toLowerCase()] || apiName || '';
  }

  /**
   * Normalize API response into our standard event format.
   * The API returns: { success, total, events: [...] }
   * Each event: { id, date, time, sport, sport_code, discipline, venue: {name,city,country}, teams, is_medal_event, raw }
   */
  function normalizeAPIData(data) {
    var events = Array.isArray(data) ? data : (data.events || data.schedule || []);
    return events.map(function (e) {
      // Build venue string from venue object
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

      return {
        date: e.date || '',
        time: e.time || '',
        sport: displaySportName(e.sport),
        discipline: e.discipline || '',
        event: e.discipline || e.event || e.eventName || '',
        venue: venue,
        status: e.status || 'upcoming',
        broadcast: e.broadcast || []
      };
    });
  }

  /**
   * Main entry: try API first, fall back to static JSON.
   */
  function fetchSchedule() {
    var apiKey = CONFIG.RAPIDAPI_KEY;

    if (apiKey) {
      return fetchFromAPI(apiKey).catch(function (err) {
        console.warn('RapidAPI failed, using local fallback:', err.message);
        return fetchFromLocal(CONFIG.FALLBACK_SCHEDULE);
      });
    }
    return fetchFromLocal(CONFIG.FALLBACK_SCHEDULE);
  }

  /**
   * Sport name normalization map for matching athletes to schedule events.
   * Maps variations of sport names to a canonical form.
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
   * Discipline matching map: maps athlete discipline/sport to schedule event disciplines.
   */
  var disciplineMap = {
    'freestyle aerials': ['aerials'],
    'freestyle moguls': ['moguls'],
    'freeski halfpipe': ['halfpipe', 'freeski halfpipe'],
    'freeski slopestyle & big air': ['slopestyle', 'big air', 'freeski slopestyle', 'freeski big air'],
    'snowboard cross': ['snowboard cross', 'cross'],
    'snowboard halfpipe': ['halfpipe', 'snowboard halfpipe'],
    'snowboard slopestyle': ['slopestyle', 'snowboard slopestyle'],
    'snowboard big air': ['big air', 'snowboard big air']
  };

  function normalizeSport(name) {
    if (!name) return '';
    var lower = name.toLowerCase().trim();
    return sportAliases[lower] || lower;
  }

  /**
   * Match schedule events to athletes.
   * Returns enriched schedule entries with matched athletes.
   */
  function matchScheduleToAthletes(schedule, athletes) {
    // Build a lookup: normalized sport → list of athletes
    var sportMap = {};
    athletes.forEach(function (ath) {
      var key = normalizeSport(ath.sport);
      if (!sportMap[key]) sportMap[key] = [];
      sportMap[key].push(ath);
    });

    return schedule.map(function (evt) {
      var eventSport = normalizeSport(evt.sport);
      var matched = sportMap[eventSport] || [];

      // If the event has a discipline, try to narrow down athletes
      if (evt.discipline && matched.length > 0) {
        var evtDisc = evt.discipline.toLowerCase().trim();
        var narrowed = matched.filter(function (ath) {
          var athSportLower = ath.sport.toLowerCase().trim();
          var athDiscLower = (ath.discipline || '').toLowerCase().trim();

          // Check discipline map for specific sub-sport matching
          var aliases = disciplineMap[athSportLower];
          if (aliases) {
            return aliases.some(function (a) {
              return evtDisc.indexOf(a) !== -1;
            });
          }
          // If athlete has a discipline field, match against it
          if (athDiscLower) {
            return evtDisc.indexOf(athDiscLower) !== -1 ||
              athDiscLower.indexOf(evtDisc) !== -1;
          }
          // No discipline filter - keep all athletes in this sport
          return true;
        });
        if (narrowed.length > 0) {
          matched = narrowed;
        }
      }

      return {
        date: evt.date,
        time: evt.time,
        sport: evt.sport,
        discipline: evt.discipline,
        event: evt.event,
        venue: evt.venue,
        status: evt.status || 'upcoming',
        broadcast: evt.broadcast || [],
        athletes: matched
      };
    }).filter(function (evt) {
      return evt.athletes.length > 0;
    });
  }

  return {
    fetchSchedule: fetchSchedule,
    matchScheduleToAthletes: matchScheduleToAthletes,
    normalizeSport: normalizeSport
  };
})();
