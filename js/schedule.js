/**
 * schedule.js - Fetch schedule from RapidAPI (sole source of truth),
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
   * Classify "unknown" sport events using venue and discipline text.
   * The API misclassifies ~157 events as "unknown". We fix them here.
   */
  function classifyUnknownEvent(e) {
    var disc = (e.discipline || '').toLowerCase();
    var venueName = (e.venue && e.venue.name) ? e.venue.name.toLowerCase() : '';

    // Cortina Sliding Centre → Luge (singles/doubles/relay), Skeleton (heats), Bobsleigh
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

    // Milano Ice Skating Arena → Short Track or Figure Skating
    if (venueName.indexOf('ice skating') !== -1 || venueName.indexOf('palasharp') !== -1) {
      if (disc.indexOf('single skating') !== -1 || disc.indexOf('team event') !== -1 ||
          disc.indexOf('free skating') !== -1 || disc.indexOf('ice danc') !== -1 ||
          disc.indexOf('pairs') !== -1) {
        return 'Figure Skating';
      }
      return 'Short Track Speed Skating';
    }

    // Null venue events — venue name is embedded in discipline string
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

  /**
   * Clean discipline text: remove embedded venue names and "Medal Event" markers.
   */
  function cleanDiscipline(disc) {
    if (!disc) return '';
    // Remove embedded venue names (they appear concatenated without spaces)
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

  /**
   * Normalize API response into our standard event format.
   */
  function normalizeAPIData(data) {
    var events = Array.isArray(data) ? data : (data.events || data.schedule || []);
    return events.map(function (e) {
      // Determine sport — fix "unknown" classification
      var sport = e.sport;
      if (!sport || sport === 'unknown') {
        var classified = classifyUnknownEvent(e);
        sport = classified || 'unknown';
      } else {
        sport = displaySportName(sport);
      }

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

      // If venue was missing but embedded in discipline, extract it
      if (!venue) {
        var rawDisc = e.discipline || '';
        if (rawDisc.indexOf('Livigno Aerials') !== -1) venue = 'Livigno Aerials & Moguls Park, Livigno';
        else if (rawDisc.indexOf('Livigno Snow') !== -1) venue = 'Livigno Snow Park, Livigno';
        else if (rawDisc.indexOf('Stelvio') !== -1) venue = 'Stelvio Ski Centre, Bormio';
        else if (rawDisc.indexOf('Tofane') !== -1) venue = 'Tofane Alpine Skiing Centre, Cortina';
        else if (rawDisc.indexOf('Tesero') !== -1) venue = 'Tesero Cross-Country Skiing Stadium, Tesero';
        else if (rawDisc.indexOf('Predazzo') !== -1) venue = 'Predazzo Ski Jumping Stadium, Predazzo';
      }

      var cleaned = cleanDiscipline(e.discipline);

      // Detect event gender from ALL raw API text before cleaning strips it
      var genderSource = [
        e.discipline || '',
        e.event || '',
        e.eventName || '',
        e.gender || ''
      ].join(' ').toLowerCase();
      var eventGender = '';
      if (genderSource.indexOf('mixed') !== -1) {
        eventGender = '';
      } else if (genderSource.indexOf('women') !== -1 || genderSource.indexOf('ladies') !== -1) {
        eventGender = 'F';
      } else if (/\bmen\b/.test(genderSource) || genderSource.indexOf("men's") !== -1 || genderSource.indexOf("men\u2019s") !== -1) {
        eventGender = 'M';
      }

      return {
        id: e.id || '',
        date: e.date || '',
        time: e.time || '',
        sport: sport,
        discipline: cleaned,
        event: cleaned || e.event || e.eventName || '',
        venue: venue,
        isMedalEvent: e.is_medal_event || false,
        status: e.status || 'upcoming',
        eventGender: eventGender,
        broadcast: []
      };
    }).filter(function (e) {
      // Only keep medal events; drop training, qualifiers, and unknown sports
      return e.sport !== 'unknown' && e.isMedalEvent;
    });
  }

  /**
   * Fetch broadcast rules from data/broadcast.json.
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
   * Convert CET time (HH:MM) to Mountain Standard Time (HH:MM).
   * CET = UTC+1, MST = UTC-7 → offset is -8 hours.
   * February has no DST in either timezone.
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
   * Apply broadcast rules to normalized events.
   * Each event gets: sport-specific live network, NBC primetime (medal events), Peacock streaming.
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
          time: cetToMountain(evt.time)
        });
      }

      // NBC primetime for medal events
      if (evt.isMedalEvent && rules.medalPrimetime) {
        broadcasts.push({
          network: rules.medalPrimetime.network,
          type: 'primetime',
          time: rules.medalPrimetime.time
        });
      }

      // Peacock streaming (always)
      if (rules.streaming) {
        broadcasts.push({
          network: rules.streaming.network,
          type: rules.streaming.type || 'streaming'
        });
      }

      return assign(evt, { broadcast: broadcasts });
    });
  }

  /** Simple object assign polyfill for older browsers. */
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

  /**
   * Main entry: fetch from API and apply broadcast rules.
   */
  function fetchSchedule() {
    var apiKey = CONFIG.RAPIDAPI_KEY;
    if (!apiKey) {
      return Promise.reject(new Error('No RapidAPI key configured. Add your key in js/config.js.'));
    }
    return Promise.all([
      fetchFromAPI(apiKey),
      fetchBroadcastRules()
    ]).then(function (results) {
      var events = results[0];
      var rules = results[1];
      return applyBroadcastRules(events, rules);
    });
  }

  /**
   * Sport name normalization map for matching athletes to schedule events.
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
   * Filters by gender when the event name specifies Men's or Women's.
   */
  function matchScheduleToAthletes(schedule, athletes) {
    var sportMap = {};
    athletes.forEach(function (ath) {
      var key = normalizeSport(ath.sport);
      if (!sportMap[key]) sportMap[key] = [];
      sportMap[key].push(ath);
    });

    return schedule.map(function (evt) {
      var eventSport = normalizeSport(evt.sport);
      var matched = sportMap[eventSport] || [];

      // Filter by gender: "Men's" events → M only, "Women's" → F only
      if (evt.eventGender && matched.length > 0) {
        matched = matched.filter(function (ath) {
          return !ath.gender || ath.gender === evt.eventGender;
        });
      }

      if (matched.length > 0) {
        var evtDisc = (evt.discipline || '').toLowerCase().trim();
        var evtEvent = (evt.event || '').toLowerCase().trim();
        var evtText = evtDisc + ' ' + evtEvent;

        var narrowed = matched.filter(function (ath) {
          // Use events array for precise matching if available
          if (ath.events && ath.events.length > 0) {
            return ath.events.some(function (ev) {
              return evtText.indexOf(ev.toLowerCase()) !== -1;
            });
          }

          // Fallback to discipline-based matching
          var athSportLower = ath.sport.toLowerCase().trim();
          var athDiscLower = (ath.discipline || '').toLowerCase().trim();

          var aliases = disciplineMap[athSportLower];
          if (aliases) {
            return aliases.some(function (a) {
              return evtDisc.indexOf(a) !== -1;
            });
          }
          if (athDiscLower) {
            return evtDisc.indexOf(athDiscLower) !== -1 ||
              athDiscLower.indexOf(evtDisc) !== -1;
          }
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
        isMedalEvent: evt.isMedalEvent || false,
        status: evt.status || 'upcoming',
        eventGender: evt.eventGender || '',
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
