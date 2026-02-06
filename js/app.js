/**
 * app.js - Main initialization, rendering, filtering, sorting, and search.
 */
(function () {
  // State
  var allEvents = [];
  var currentFilter = 'all'; // 'all' | 'parkCity'
  var currentSort = 'date';  // 'date' | 'sport' | 'athlete'
  var searchQuery = '';

  // Sport emoji map
  var sportEmoji = {
    'alpine skiing': '\u26F7\uFE0F',
    'biathlon': '\uD83C\uDFBF',
    'bobsleigh': '\uD83D\uDED7',
    'cross-country skiing': '\uD83C\uDFBF',
    'curling': '\uD83E\uDD4C',
    'figure skating': '\u26F8\uFE0F',
    'freestyle skiing': '\uD83C\uDFBF',
    'ice hockey': '\uD83C\uDFD2',
    'luge': '\uD83D\uDED7',
    'nordic combined': '\uD83C\uDFBF',
    'short track speed skating': '\u26F8\uFE0F',
    'skeleton': '\uD83D\uDED7',
    'ski jumping': '\uD83C\uDFBF',
    'snowboard': '\uD83C\uDFC2',
    'speed skating': '\u26F8\uFE0F'
  };

  function getEmoji(sport) {
    var key = (sport || '').toLowerCase();
    return sportEmoji[key] || '\uD83C\uDFC5';
  }

  /**
   * Determine if an event is qualifying/preliminary (not a medal event).
   */
  function isQualifyingEvent(eventName) {
    var name = (eventName || '').toLowerCase();
    var qualifiers = ['training', 'qualification', 'quarterfinal', 'semifinal',
                      'heats', 'short program'];
    for (var i = 0; i < qualifiers.length; i++) {
      if (name.indexOf(qualifiers[i]) !== -1) return true;
    }
    // "Run 1 & 2" but NOT "Run 3 & 4 (Final)"
    if (/run 1/i.test(name) && name.indexOf('final') === -1) return true;
    // "Seeding" but not "Seeding & Finals"
    if (name.indexOf('seeding') !== -1 && name.indexOf('finals') === -1) return true;
    return false;
  }

  // ---- Calendar helpers ----

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatUTCCompact(d) {
    return d.getUTCFullYear() +
      pad2(d.getUTCMonth() + 1) +
      pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) +
      pad2(d.getUTCMinutes()) +
      pad2(d.getUTCSeconds()) + 'Z';
  }

  function getEventTimes(evt) {
    var isoStr = (evt.date || '2026-02-06') + 'T' + (evt.time || '12:00') + ':00+01:00';
    var start = new Date(isoStr);
    var end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return {
      startCompact: formatUTCCompact(start),
      endCompact: formatUTCCompact(end),
      startISO: start.toISOString(),
      endISO: end.toISOString()
    };
  }

  function buildCalDescription(evt) {
    var lines = [];
    lines.push('2026 Winter Olympics');
    lines.push(evt.sport + ' - ' + (evt.event || evt.discipline || ''));
    lines.push('');
    if (evt.venue) {
      lines.push('Venue: ' + evt.venue);
      lines.push('');
    }
    if (evt.broadcast && evt.broadcast.length > 0) {
      lines.push('Where to Watch:');
      evt.broadcast.forEach(function (b) {
        var line = '- ' + b.network;
        if (b.time) line += ' at ' + formatBroadcastTime(b.time);
        var typeLabel = b.type === 'streaming' ? 'Stream' : b.type.charAt(0).toUpperCase() + b.type.slice(1);
        line += ' (' + typeLabel + ')';
        lines.push(line);
      });
      lines.push('');
    }
    if (evt.athletes.length > 0) {
      lines.push('Utah / Park City Athletes:');
      evt.athletes.forEach(function (a) {
        var line = '- ' + a.name;
        if (a.isParkCity) line += ' (Park City)';
        else if (a.country && a.country !== 'USA') line += ' (' + a.country + ')';
        lines.push(line);
      });
    }
    return lines.join('\n');
  }

  function icsEscape(str) {
    return (str || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function buildICSDataURI(title, times, description, location) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OlympicsSchedule//EN',
      'BEGIN:VEVENT',
      'DTSTART:' + times.startCompact,
      'DTEND:' + times.endCompact,
      'SUMMARY:' + icsEscape(title),
      'DESCRIPTION:' + icsEscape(description),
      'LOCATION:' + icsEscape(location || ''),
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
  }

  function buildCalendarHTML(evt) {
    var title = evt.sport + ': ' + (evt.event || evt.discipline || '') + ' - 2026 Olympics';
    var times = getEventTimes(evt);
    var desc = buildCalDescription(evt);
    var location = evt.venue || '';

    var googleURL = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(title) +
      '&dates=' + times.startCompact + '/' + times.endCompact +
      '&details=' + encodeURIComponent(desc) +
      '&location=' + encodeURIComponent(location);

    var outlookURL = 'https://outlook.live.com/calendar/0/action/compose' +
      '?rru=addevent' +
      '&subject=' + encodeURIComponent(title) +
      '&startdt=' + times.startISO +
      '&enddt=' + times.endISO +
      '&body=' + encodeURIComponent(desc) +
      '&location=' + encodeURIComponent(location);

    var yahooURL = 'https://calendar.yahoo.com/?v=60' +
      '&title=' + encodeURIComponent(title) +
      '&st=' + times.startCompact +
      '&dur=0200' +
      '&desc=' + encodeURIComponent(desc) +
      '&in_loc=' + encodeURIComponent(location);

    var icsURI = buildICSDataURI(title, times, desc, location);

    var h = '<div class="cal-action" onclick="event.stopPropagation()">';
    h += '<button type="button" class="cal-btn" onclick="_toggleCal(this)" title="Add to Calendar">\uD83D\uDCC5 <span class="cal-btn-label">Add to Calendar</span><span class="cal-btn-arrow">\u25BE</span></button>';
    h += '<div class="cal-dropdown">';
    h += '<div class="cal-dropdown-title">Add to Calendar</div>';
    h += '<a href="' + escapeHTML(googleURL) + '" target="_blank" rel="noopener" class="cal-link"><span class="cal-icon cal-google">G</span> Google Calendar</a>';
    h += '<a href="' + escapeHTML(outlookURL) + '" target="_blank" rel="noopener" class="cal-link"><span class="cal-icon cal-outlook">O</span> Outlook</a>';
    h += '<a href="' + escapeHTML(yahooURL) + '" target="_blank" rel="noopener" class="cal-link"><span class="cal-icon cal-yahoo">Y</span> Yahoo</a>';
    h += '<a href="' + escapeHTML(icsURI) + '" download="olympic-event.ics" class="cal-link"><span class="cal-icon cal-ics">\u2B07</span> Apple / .ics</a>';
    h += '</div></div>';
    return h;
  }

  window._toggleCal = function (btn) {
    var container = btn.parentElement;
    var wasOpen = container.classList.contains('open');
    var allOpen = document.querySelectorAll('.cal-action.open');
    for (var i = 0; i < allOpen.length; i++) allOpen[i].classList.remove('open');
    if (!wasOpen) container.classList.add('open');
  };

  /**
   * Format an ISO date string into a friendly display.
   */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr + 'T00:00:00');
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Format time string to local timezone.
   * Input is expected as HH:MM in CET (UTC+1) since games are in Italy.
   */
  function formatTime(timeStr, dateStr) {
    if (!timeStr) return 'TBD';
    try {
      // Parse as CET (Italy time)
      var isoStr = (dateStr || '2026-02-06') + 'T' + timeStr + ':00+01:00';
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch (e) {
      return timeStr;
    }
  }

  /**
   * Format broadcast time (HH:MM in MT) to display format like "6:00 PM MT".
   */
  function formatBroadcastTime(timeStr) {
    if (!timeStr) return 'Stream';
    var parts = timeStr.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1] || '00';
    var ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return h + ':' + m + ' ' + ampm + ' MT';
  }

  /**
   * Apply filter, sort, and search to events.
   */
  function getFilteredEvents() {
    var events = allEvents;

    // Filter by Park City
    if (currentFilter === 'parkCity') {
      events = events.map(function (evt) {
        var pcAthletes = evt.athletes.filter(function (a) { return a.isParkCity; });
        if (pcAthletes.length === 0) return null;
        return Object.assign({}, evt, { athletes: pcAthletes });
      }).filter(Boolean);
    }

    // Search
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      events = events.filter(function (evt) {
        if (evt.sport.toLowerCase().indexOf(q) !== -1) return true;
        if (evt.event.toLowerCase().indexOf(q) !== -1) return true;
        if ((evt.discipline || '').toLowerCase().indexOf(q) !== -1) return true;
        if (evt.athletes.some(function (a) {
          return a.name.toLowerCase().indexOf(q) !== -1;
        })) return true;
        return (evt.broadcast || []).some(function (b) {
          return b.network.toLowerCase().indexOf(q) !== -1;
        });
      });
    }

    // Sort
    events = events.slice().sort(function (a, b) {
      if (currentSort === 'date') {
        var dc = (a.date || '').localeCompare(b.date || '');
        if (dc !== 0) return dc;
        return (a.time || '').localeCompare(b.time || '');
      }
      if (currentSort === 'sport') {
        var sc = (a.sport || '').localeCompare(b.sport || '');
        if (sc !== 0) return sc;
        return (a.date || '').localeCompare(b.date || '');
      }
      if (currentSort === 'athlete') {
        var nameA = a.athletes[0] ? a.athletes[0].name : '';
        var nameB = b.athletes[0] ? b.athletes[0].name : '';
        return nameA.localeCompare(nameB);
      }
      return 0;
    });

    return events;
  }

  /**
   * Group events by date (or by sport if sorting by sport).
   */
  function groupEvents(events) {
    var groups = {};
    var groupKey = currentSort === 'sport' ? 'sport' : 'date';

    events.forEach(function (evt) {
      var key = evt[groupKey] || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(evt);
    });

    return groups;
  }

  /**
   * Render grouped events into the DOM.
   */
  function render() {
    var container = document.getElementById('schedule-container');
    var events = getFilteredEvents();

    if (events.length === 0) {
      container.innerHTML =
        '<div class="no-results">' +
        '<h3>No events found</h3>' +
        '<p>Try adjusting your filters or search terms.</p>' +
        '</div>';
      return;
    }

    var groups = groupEvents(events);
    var html = '';

    Object.keys(groups).forEach(function (key) {
      var groupLabel = currentSort === 'sport' ? key : formatDate(key);
      html += '<div class="date-group">';
      html += '<h2 class="date-header">' + escapeHTML(groupLabel) + '</h2>';

      groups[key].forEach(function (evt) {
        var statusClass = '';
        var statusBadge = '';
        if (evt.status === 'live') {
          statusClass = ' status-live';
          statusBadge = '<span class="status-indicator live">Live</span>';
        } else if (evt.status === 'completed') {
          statusClass = ' status-completed';
          statusBadge = '<span class="status-indicator completed">Final</span>';
        }

        var athleteTags = evt.athletes.map(function (a) {
          var cls = a.isParkCity ? 'athlete-tag park-city' : 'athlete-tag';
          var badge = a.isParkCity
            ? ' <span class="badge">PC</span>'
            : '';
          var country = a.country && a.country !== 'USA'
            ? ' (' + escapeHTML(a.country) + ')'
            : '';
          return '<span class="' + cls + '">' +
            escapeHTML(a.name) + country + badge +
            '</span>';
        }).join('');

        var timeDisplay = formatTime(evt.time, evt.date);
        var emoji = getEmoji(evt.sport);
        var qualifying = isQualifyingEvent(evt.event || evt.discipline || '');

        if (qualifying) {
          // Compact collapsible card for qualifying events
          html += '<div class="event-card qualifying' + statusClass + '" onclick="this.classList.toggle(\'expanded\')">';
          html += '<div class="event-time">' + escapeHTML(timeDisplay) + statusBadge + '</div>';
          html += '<div class="event-details">';
          html += '<div class="event-summary">';
          html += '<span class="event-sport">' + emoji + ' ' + escapeHTML(evt.sport) + '</span>';
          html += '<span class="event-name-inline">' + escapeHTML(evt.event || evt.discipline || '') + '</span>';
          html += '<span class="expand-toggle"></span>';
          html += '</div>';
          html += '<div class="event-expanded">';
          html += '<div class="event-athletes">' + athleteTags + '</div>';
          if (evt.venue) {
            html += '<div class="event-venue">' + escapeHTML(evt.venue) + '</div>';
          }
          if (evt.broadcast && evt.broadcast.length > 0) {
            html += '<div class="event-broadcast">';
            html += '\uD83D\uDCFA ';
            evt.broadcast.forEach(function (b, i) {
              if (i > 0) html += '<span class="broadcast-sep">|</span>';
              html += '<span class="broadcast-entry">';
              html += '<span class="broadcast-network">' + escapeHTML(b.network) + '</span> ';
              if (b.time) {
                html += '<span class="broadcast-time">' + formatBroadcastTime(b.time) + '</span> ';
              }
              var typeLabel = b.type === 'streaming' ? 'Stream' : b.type.charAt(0).toUpperCase() + b.type.slice(1);
              html += '<span class="broadcast-type ' + escapeHTML(b.type) + '">' + escapeHTML(typeLabel) + '</span>';
              html += '</span>';
            });
            html += '</div>';
          }
          html += '</div>'; // .event-expanded
          html += '</div>'; // .event-details
          html += buildCalendarHTML(evt);
          html += '</div>'; // .event-card
        } else {
          // Full medal/finals event card (unchanged structure)
          html += '<div class="event-card' + statusClass + '">';
          html += '<div class="event-time"><span class="event-date-label">' + escapeHTML(formatDate(evt.date)) + '</span>' + escapeHTML(timeDisplay) + statusBadge + '</div>';
          html += '<div class="event-details">';
          html += '<div class="event-sport">' + emoji + ' ' + escapeHTML(evt.sport) + '</div>';
          html += '<div class="event-name">' + escapeHTML(evt.event || evt.discipline || '') + '</div>';
          html += '<div class="event-athletes">' + athleteTags + '</div>';
          if (evt.venue) {
            html += '<div class="event-venue">' + escapeHTML(evt.venue) + '</div>';
          }
          if (evt.broadcast && evt.broadcast.length > 0) {
            html += '<div class="event-broadcast">';
            html += '\uD83D\uDCFA ';
            evt.broadcast.forEach(function (b, i) {
              if (i > 0) html += '<span class="broadcast-sep">|</span>';
              html += '<span class="broadcast-entry">';
              html += '<span class="broadcast-network">' + escapeHTML(b.network) + '</span> ';
              if (b.time) {
                html += '<span class="broadcast-time">' + formatBroadcastTime(b.time) + '</span> ';
              }
              var typeLabel = b.type === 'streaming' ? 'Stream' : b.type.charAt(0).toUpperCase() + b.type.slice(1);
              html += '<span class="broadcast-type ' + escapeHTML(b.type) + '">' + escapeHTML(typeLabel) + '</span>';
              html += '</span>';
            });
            html += '</div>';
          }
          html += '</div>'; // .event-details
          html += buildCalendarHTML(evt);
          html += '</div>'; // .event-card
        }
      });

      html += '</div>';
    });

    container.innerHTML = html;
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Set up filter buttons.
   */
  function initFilters() {
    var btns = document.querySelectorAll('.filter-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        render();
      });
    });
  }

  /**
   * Set up sort buttons.
   */
  function initSort() {
    var btns = document.querySelectorAll('.sort-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentSort = btn.dataset.sort;
        render();
      });
    });
  }

  /**
   * Set up search input.
   */
  function initSearch() {
    var input = document.getElementById('search-input');
    var debounceTimer;
    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        searchQuery = input.value.trim();
        render();
      }, 250);
    });
  }

  /**
   * Show status message.
   */
  function showStatus(msg, type) {
    var bar = document.getElementById('status-bar');
    bar.textContent = msg;
    bar.className = 'status-bar ' + (type || '');
  }

  function hideStatus() {
    var bar = document.getElementById('status-bar');
    bar.className = 'status-bar hidden';
  }

  /**
   * Main init: fetch data, match, render.
   */
  function init() {
    initFilters();
    initSort();
    initSearch();

    // Close calendar dropdowns on outside click
    document.addEventListener('click', function () {
      var allOpen = document.querySelectorAll('.cal-action.open');
      for (var i = 0; i < allOpen.length; i++) allOpen[i].classList.remove('open');
    });

    Promise.all([
      Athletes.fetchAthletes(),
      Schedule.fetchSchedule()
    ]).then(function (results) {
      var athletes = results[0];
      var schedule = results[1];

      if (!athletes || athletes.length === 0) {
        showStatus('No athlete data loaded. Check config or data/athletes-seed.csv.', 'error');
        return;
      }

      if (!schedule || schedule.length === 0) {
        showStatus('No schedule data loaded. Check config or data/schedule.json.', 'error');
        return;
      }

      allEvents = Schedule.matchScheduleToAthletes(schedule, athletes);

      if (allEvents.length === 0) {
        showStatus(
          'Loaded ' + athletes.length + ' athletes and ' + schedule.length +
          ' events, but no matches found. Sport names may need alignment.', 'info'
        );
      } else {
        showStatus(
          'Loaded ' + athletes.length + ' athletes, ' + allEvents.length +
          ' matching events found.', 'info'
        );
        setTimeout(hideStatus, 4000);
      }

      render();
    }).catch(function (err) {
      console.error('Init error:', err);
      showStatus('Error loading data: ' + err.message, 'error');
      document.getElementById('schedule-container').innerHTML =
        '<div class="no-results">' +
        '<h3>Failed to load data</h3>' +
        '<p>' + escapeHTML(err.message) + '</p>' +
        '<p>Make sure you\'re serving this from a web server (or use a local server like <code>python3 -m http.server</code>).</p>' +
        '</div>';
    });
  }

  // Start on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
