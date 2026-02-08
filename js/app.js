/**
 * app.js - Main initialization, rendering, filtering, sorting, and search.
 */
(function () {
  // State
  var allEvents = [];
  var currentSort = 'date';  // 'date' | 'sport' | 'athlete'
  var searchQuery = '';
  var showPast = false;
  var initialScrollDone = false;
  var athleteInfoMap = {}; // populated by groupEvents in athlete mode

  var VALID_VIEWS = { date: true, sport: true, athlete: true };

  // GA4 event tracking helper
  function track(eventName, params) {
    if (typeof gtag === 'function') {
      gtag('event', eventName, params || {});
    }
  }

  // ---- Hash-based URL routing ----

  function readHash() {
    var hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    return VALID_VIEWS[hash] ? hash : '';
  }

  function updateHash(view) {
    var newHash = '#' + view;
    if (window.location.hash !== newHash) {
      history.pushState(null, '', newHash);
    }
    // GA4 virtual pageview
    if (typeof gtag === 'function') {
      gtag('config', 'G-T2RPDQ96M7', { page_path: '/' + view });
    }
  }

  var VIEW_LABELS = { date: 'Date', sport: 'Sport', athlete: 'Athlete' };

  function syncSortButtons() {
    var btns = document.querySelectorAll('.sort-btn');
    btns.forEach(function (b) {
      if (b.dataset.sort === currentSort) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
    var summaryVal = document.getElementById('controls-summary-value');
    if (summaryVal) {
      summaryVal.textContent = VIEW_LABELS[currentSort] || 'Date';
    }
  }

  /**
   * Get today's date as YYYY-MM-DD in local timezone.
   */
  function getTodayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /**
   * Check if a date string (YYYY-MM-DD) is before today.
   */
  function isPastDate(dateStr) {
    if (!dateStr) return false;
    return dateStr < getTodayStr();
  }

  // Inline SVG icon helper
  function svg(paths, vb) {
    return '<svg class="icon" viewBox="' + (vb || '0 0 24 24') + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  // Sport SVG icon map
  var skiIcon = svg('<circle cx="13" cy="3.5" r="2"/><path d="M7 21l5-10 3 2 3-4"/><line x1="5.5" y1="4" x2="18.5" y2="20"/>');
  var skateIcon = svg('<circle cx="12" cy="4" r="2"/><path d="M8 21h8"/><path d="M10 21v-5l-2-4 4-4 4 4-2 4v5"/>');
  var sledIcon = svg('<path d="M4 18c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2"/><path d="M4 14l4-8h8l4 8"/><line x1="3" y1="18" x2="21" y2="18"/>');
  var hockeyIcon = svg('<circle cx="16" cy="18" r="2.5" fill="currentColor" stroke="none"/><path d="M6 3l4 12"/><path d="M4 15h10"/>');
  var curlingIcon = svg('<circle cx="12" cy="14" r="6"/><circle cx="12" cy="14" r="2"/><path d="M12 4v4"/><path d="M10 4h4"/>');
  var snowboardIcon = svg('<circle cx="14" cy="4" r="2"/><path d="M6 20l12-12"/><path d="M10 14l-2 2"/><path d="M14 10l2-2"/>');
  var jumpIcon = svg('<circle cx="14" cy="3.5" r="2"/><path d="M8 21l4-10"/><path d="M12 11l5-5"/><path d="M4 20l4-2"/>');
  var medalIcon = svg('<circle cx="12" cy="14" r="6"/><path d="M9 3h6"/><path d="M9 3l-1 8"/><path d="M15 3l1 8"/>');

  var sportIcons = {
    'alpine skiing': skiIcon,
    'biathlon': skiIcon,
    'bobsleigh': sledIcon,
    'cross-country skiing': skiIcon,
    'curling': curlingIcon,
    'figure skating': skateIcon,
    'freestyle skiing': skiIcon,
    'ice hockey': hockeyIcon,
    'luge': sledIcon,
    'nordic combined': jumpIcon,
    'short track speed skating': skateIcon,
    'skeleton': sledIcon,
    'ski jumping': jumpIcon,
    'snowboard': snowboardIcon,
    'speed skating': skateIcon
  };

  function getSportIcon(sport) {
    var key = (sport || '').toLowerCase();
    return sportIcons[key] || medalIcon;
  }

  // Utility SVG icons
  var calendarIcon = svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
  var tvIcon = svg('<rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>');
  var downloadIcon = svg('<path d="M12 5v10"/><path d="M7 12l5 5 5-5"/><line x1="5" y1="20" x2="19" y2="20"/>');
  var chevronDown = '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

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
      lines.push('Park City Athletes:');
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
    h += '<button type="button" class="cal-btn" onclick="_toggleCal(this)" title="Add to Calendar">' + calendarIcon + '<span class="cal-btn-label">Add to Calendar</span><span class="cal-btn-arrow">' + chevronDown + '</span></button>';
    h += '<div class="cal-dropdown">';
    h += '<div class="cal-dropdown-title">Add to Calendar</div>';
    h += '<a href="' + escapeHTML(googleURL) + '" target="_blank" rel="noopener" class="cal-link" onclick="_trackCal(\'Google\')"><span class="cal-icon cal-google">G</span> Google Calendar</a>';
    h += '<a href="' + escapeHTML(outlookURL) + '" target="_blank" rel="noopener" class="cal-link" onclick="_trackCal(\'Outlook\')"><span class="cal-icon cal-outlook">O</span> Outlook</a>';
    h += '<a href="' + escapeHTML(yahooURL) + '" target="_blank" rel="noopener" class="cal-link" onclick="_trackCal(\'Yahoo\')"><span class="cal-icon cal-yahoo">Y</span> Yahoo</a>';
    h += '<a href="' + escapeHTML(icsURI) + '" download="olympic-event.ics" class="cal-link" onclick="_trackCal(\'Apple_ICS\')"><span class="cal-icon cal-ics">' + downloadIcon + '</span> Apple / .ics</a>';
    h += '</div></div>';
    return h;
  }

  window._toggleEvent = function (card) {
    card.classList.toggle('expanded');
    if (card.classList.contains('expanded')) {
      var name = card.querySelector('.event-name-inline');
      var sport = card.querySelector('.event-sport-label');
      track('event_expand', {
        event_name: name ? name.textContent : '',
        sport: sport ? sport.textContent : ''
      });
    }
  };

  window._toggleAthlete = function (row) {
    row.classList.toggle('expanded');
    if (row.classList.contains('expanded')) {
      var name = row.querySelector('.athlete-row-name');
      track('athlete_expand', {
        athlete_name: name ? name.textContent : ''
      });
    }
  };

  window._trackCal = function (provider) {
    track('calendar_add', { calendar_provider: provider });
  };

  window._toggleCal = function (btn) {
    var container = btn.parentElement;
    var wasOpen = container.classList.contains('open');
    var allOpen = document.querySelectorAll('.cal-action.open');
    for (var i = 0; i < allOpen.length; i++) allOpen[i].classList.remove('open');
    if (!wasOpen) {
      container.classList.add('open');
      track('calendar_open');
    }
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

    // Hide past events unless toggled on
    if (!showPast) {
      var today = getTodayStr();
      events = events.filter(function (evt) {
        return (evt.date || '') >= today;
      });
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
   * Group events by date, sport, or athlete.
   */
  function groupEvents(events) {
    var groups = {};

    if (currentSort === 'athlete') {
      // Group by individual athlete — same event may appear under multiple athletes
      athleteInfoMap = {};
      events.forEach(function (evt) {
        evt.athletes.forEach(function (ath) {
          var key = ath.name;
          if (!groups[key]) {
            groups[key] = [];
            athleteInfoMap[key] = ath;
          }
          groups[key].push(evt);
        });
      });
      // Sort events within each athlete by date then time
      Object.keys(groups).forEach(function (key) {
        groups[key].sort(function (a, b) {
          var dc = (a.date || '').localeCompare(b.date || '');
          if (dc !== 0) return dc;
          return (a.time || '').localeCompare(b.time || '');
        });
      });
      return groups;
    }

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
    var todayStr = getTodayStr();

    var isAthleteView = currentSort === 'athlete';
    var sortedKeys = Object.keys(groups);
    if (isAthleteView) sortedKeys.sort();

    // Athlete view: compact expandable list
    if (isAthleteView) {
      html += '<div class="athlete-list">';
      html += '<p class="athlete-list-note">Qualified to compete, may not have advanced to finals</p>';
      sortedKeys.forEach(function (key) {
        var athInfo = athleteInfoMap[key] || {};
        var country = athInfo.country && athInfo.country !== 'USA' ? ' (' + escapeHTML(athInfo.country) + ')' : '';
        var evts = groups[key];
        html += '<div class="athlete-row" onclick="_toggleAthlete(this)">';
        html += '<div class="athlete-row-header">';
        html += '<span class="athlete-row-name">' + escapeHTML(key) + country + '</span>';
        html += '<span class="athlete-row-sport">' + escapeHTML(athInfo.sport || '') + '</span>';
        html += '<span class="athlete-row-count">' + evts.length + ' event' + (evts.length !== 1 ? 's' : '') + '</span>';
        html += '<span class="expand-toggle"></span>';
        html += '</div>';
        html += '<div class="athlete-row-events">';
        evts.forEach(function (evt) {
          var pastClass = isPastDate(evt.date) ? ' past-event-text' : '';
          html += '<div class="athlete-event-item' + pastClass + '">';
          html += '<span class="athlete-event-date">' + escapeHTML(formatDate(evt.date)) + '</span>';
          html += '<span class="athlete-event-time">' + escapeHTML(formatTime(evt.time, evt.date)) + '</span>';
          html += '<span class="athlete-event-name">' + escapeHTML(evt.event || evt.discipline || '') + '</span>';
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
      container.innerHTML = html;
      return;
    }

    sortedKeys.forEach(function (key) {
      var groupLabel, isPast, isToday;
      if (currentSort === 'sport') {
        groupLabel = key;
        isPast = false;
        isToday = false;
      } else {
        groupLabel = formatDate(key);
        isPast = isPastDate(key);
        isToday = key === todayStr;
      }
      var groupClass = 'date-group';
      if (isPast) groupClass += ' past-group';
      if (isToday) groupClass += ' today-group';
      html += '<div class="' + groupClass + '" data-date="' + escapeHTML(key) + '">';

      var todayBadge = isToday ? '<span class="today-badge">Today</span>' : '';
      html += '<h2 class="date-header">' + escapeHTML(groupLabel) + todayBadge + '</h2>';

      // Collect unique athletes for this group (date or sport view)
      if (currentSort === 'date' || currentSort === 'sport') {
        var seen = {};
        var dateAthletes = [];
        groups[key].forEach(function (evt) {
          evt.athletes.forEach(function (a) {
            if (!seen[a.name]) {
              seen[a.name] = true;
              var label = a.name;
              if (a.country && a.country !== 'USA') label += ' (' + a.country + ')';
              dateAthletes.push(label);
            }
          });
        });
        if (dateAthletes.length > 0) {
          html += '<p class="date-athletes">' + escapeHTML(dateAthletes.join(', ')) +
            ' <span class="date-athletes-note">&mdash; qualified to compete, may not have advanced to finals</span></p>';
        }
      }

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
        var pastClass = isPastDate(evt.date) ? ' past-event' : '';

        var athleteTags = '';
        if (!isAthleteView) {
          athleteTags = evt.athletes.map(function (a) {
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
        }

        var timeDisplay = formatTime(evt.time, evt.date);
        var sportSvg = getSportIcon(evt.sport);
        var medalClass = evt.isMedalEvent ? ' medal-event' : '';
        var medalBadge = evt.isMedalEvent ? '<span class="medal-indicator">' + medalIcon + '</span>' : '';

        // All events use unified collapsible card
        html += '<div class="event-card' + medalClass + statusClass + pastClass + '" onclick="_toggleEvent(this)">';
        if (isAthleteView || currentSort !== 'date') {
          html += '<div class="event-time"><span class="event-date-label">' + escapeHTML(formatDate(evt.date)) + '</span>' + escapeHTML(timeDisplay) + statusBadge + '</div>';
        } else {
          html += '<div class="event-time">' + escapeHTML(timeDisplay) + statusBadge + '</div>';
        }
        html += '<div class="event-details">';
        html += '<div class="event-summary">';
        html += '<span class="event-name-inline">' + escapeHTML(evt.event || evt.discipline || '') + '</span>';
        html += '<span class="event-sport-label">' + escapeHTML(evt.sport) + '</span>';
        html += '<span class="expand-toggle"></span>';
        html += '</div>';
        html += '<div class="event-expanded">';
        if (athleteTags) {
          html += '<div class="event-athletes"><span class="athletes-label">Park City athletes qualified for this event (may not have advanced to finals):</span>' + athleteTags + '</div>';
        }
        if (evt.venue) {
          html += '<div class="event-venue">' + escapeHTML(evt.venue) + '</div>';
        }
        if (evt.broadcast && evt.broadcast.length > 0) {
          html += '<div class="event-broadcast">';
          html += tvIcon + ' ';
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
      });

      html += '</div>';
    });

    container.innerHTML = html;

    // Auto-scroll to today's date group on initial load
    if (!initialScrollDone && currentSort === 'date') {
      scrollToToday();
      initialScrollDone = true;
    }
  }

  /**
   * Scroll to today's date group, or the nearest future date if today has no events.
   */
  function scrollToToday() {
    var todayStr = getTodayStr();
    var groups = document.querySelectorAll('.date-group[data-date]');
    var target = null;

    for (var i = 0; i < groups.length; i++) {
      var date = groups[i].getAttribute('data-date');
      if (date === todayStr) {
        target = groups[i];
        break;
      }
      if (date > todayStr && !target) {
        target = groups[i];
      }
    }

    if (target) {
      setTimeout(function () {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
        syncSortButtons();
        updateHash(currentSort);
        track('sort_change', { sort_by: currentSort });
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
        if (searchQuery) {
          track('search', { search_term: searchQuery });
        }
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
    // Read view from URL hash before anything renders
    var hashView = readHash();
    if (hashView) {
      currentSort = hashView;
    } else {
      updateHash(currentSort);
    }

    initSort();
    syncSortButtons();
    initSearch();

    // Handle browser back/forward
    window.addEventListener('popstate', function () {
      var view = readHash() || 'date';
      if (view !== currentSort) {
        currentSort = view;
        syncSortButtons();
        render();
      }
    });

    // Mobile controls toggle
    var controlsEl = document.getElementById('controls');
    var controlsToggle = document.getElementById('controls-toggle');
    var controlsSummary = document.getElementById('controls-summary');
    controlsSummary.addEventListener('click', function () {
      controlsEl.classList.toggle('open');
    });

    // Past events toggle
    var pastBtn = document.getElementById('past-toggle');
    pastBtn.addEventListener('click', function () {
      showPast = !showPast;
      pastBtn.textContent = showPast ? 'Hide past events' : 'Show past events';
      pastBtn.classList.toggle('active', showPast);
      track('toggle_past_events', { show_past: showPast });
      render();
    });

    // Close calendar dropdowns on outside click
    document.addEventListener('click', function () {
      var allOpen = document.querySelectorAll('.cal-action.open');
      for (var i = 0; i < allOpen.length; i++) allOpen[i].classList.remove('open');
    });

    // Share buttons
    var shareURL = 'https://utah2026.townlift.com/';
    var shareTitle = 'Park City at the 2026 Winter Olympics';
    var shareText = 'Track Park City athletes competing in Milano Cortina 2026';

    document.getElementById('share-x').addEventListener('click', function () {
      window.open('https://x.com/intent/tweet?url=' + encodeURIComponent(shareURL) + '&text=' + encodeURIComponent(shareText), '_blank', 'width=550,height=420');
      track('share', { method: 'x' });
    });

    document.getElementById('share-fb').addEventListener('click', function () {
      window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareURL), '_blank', 'width=550,height=420');
      track('share', { method: 'facebook' });
    });

    document.getElementById('share-email').addEventListener('click', function () {
      window.location.href = 'mailto:?subject=' + encodeURIComponent(shareTitle) + '&body=' + encodeURIComponent(shareText + '\n\n' + shareURL);
      track('share', { method: 'email' });
    });

    document.getElementById('share-copy').addEventListener('click', function () {
      var btn = this;
      var toast = btn.querySelector('.copy-toast');
      navigator.clipboard.writeText(shareURL).then(function () {
        toast.classList.add('show');
        setTimeout(function () { toast.classList.remove('show'); }, 1500);
      });
      track('share', { method: 'copy_link' });
    });

    // Install banner (Add to Home Screen)
    (function () {
      var banner = document.getElementById('install-banner');
      var actionBtn = document.getElementById('install-banner-action');
      var closeBtn = document.getElementById('install-banner-close');
      var desc = document.getElementById('install-banner-desc');
      var DISMISS_KEY = 'pc_olympics_install_dismissed';

      // Already dismissed or already running as installed PWA
      if (localStorage.getItem(DISMISS_KEY)) return;
      if (window.matchMedia('(display-mode: standalone)').matches) return;
      if (window.navigator.standalone === true) return; // iOS standalone

      var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      var isAndroid = /android/i.test(navigator.userAgent);
      var deferredPrompt = null;

      function showBanner() {
        banner.classList.remove('hidden');
        track('install_banner_shown');
      }

      function dismiss() {
        banner.classList.add('hidden');
        localStorage.setItem(DISMISS_KEY, '1');
      }

      closeBtn.addEventListener('click', function () {
        dismiss();
        track('install_banner_dismiss');
      });

      if (isIOS) {
        desc.textContent = 'Tap the share button, then "Add to Home Screen"';
        actionBtn.textContent = 'Got it';
        actionBtn.addEventListener('click', function () {
          dismiss();
          track('install_banner_action', { platform: 'ios' });
        });
        setTimeout(showBanner, 2000);
      } else {
        // Android / Chrome — capture native install prompt
        window.addEventListener('beforeinstallprompt', function (e) {
          e.preventDefault();
          deferredPrompt = e;
          desc.textContent = 'Quick access to Park City Olympic events';
          actionBtn.textContent = 'Add';
          setTimeout(showBanner, 2000);
        });

        actionBtn.addEventListener('click', function () {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (result) {
              track('install_banner_action', { platform: 'android', outcome: result.outcome });
              deferredPrompt = null;
              dismiss();
            });
          } else {
            dismiss();
          }
        });

        // Fallback for Android browsers without beforeinstallprompt
        if (isAndroid) {
          setTimeout(function () {
            if (!deferredPrompt) {
              desc.textContent = 'Tap your browser menu, then "Add to Home Screen"';
              actionBtn.textContent = 'Got it';
              actionBtn.addEventListener('click', dismiss);
              showBanner();
            }
          }, 3000);
        }
      }
    })();

    // Track footer link clicks
    document.querySelectorAll('.footer-links a').forEach(function (link) {
      link.addEventListener('click', function () {
        track('footer_link_click', { link_url: link.href, link_text: link.textContent });
      });
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
      track('data_loaded', { athletes: athletes.length, events: allEvents.length });

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
