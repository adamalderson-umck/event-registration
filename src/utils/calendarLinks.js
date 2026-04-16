/**
 * Parses a date string as UTC.
 * Supabase returns timestamptz as ISO strings with +00:00 or Z, but if the
 * string somehow lacks a timezone designator, new Date() treats it as local
 * time and toISOString() shifts it. Force UTC by appending Z when absent.
 */
function parseAsUTC(dateStr) {
  if (!dateStr) return new Date(NaN);
  // Has timezone designator: trailing Z, or ±HH:MM offset
  if (/Z$|[+-]\d{2}:\d{2}$/.test(dateStr)) return new Date(dateStr);
  return new Date(dateStr + 'Z');
}

/**
 * Formats a Date to Google Calendar's UTC format: YYYYMMDDTHHmmssZ
 */
function toGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Formats a Date to ICS format: YYYYMMDDTHHmmssZ
 */
function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Builds a Google Calendar "Add Event" URL.
 */
export function buildGoogleCalendarUrl(event) {
  const start = parseAsUTC(event.start_date);
  const end = event.end_date
    ? parseAsUTC(event.end_date)
    : new Date(start.getTime() + 60 * 60 * 1000); // default 1h

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || '',
    details: event.description || '',
    location: event.location || '',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}&dates=${toGoogleDate(start)}/${toGoogleDate(end)}`;
}

/**
 * Builds a downloadable .ics string (RFC 5545).
 */
export function buildIcsString(event) {
  const start = parseAsUTC(event.start_date);
  const end = event.end_date
    ? parseAsUTC(event.end_date)
    : new Date(start.getTime() + 60 * 60 * 1000);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Event Registration System//EN',
    'BEGIN:VEVENT',
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${event.title || ''}`,
    `DESCRIPTION:${(event.description || '').replace(/\n/g, '\\n')}`,
    `LOCATION:${event.location || ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Triggers download of an .ics file.
 */
export function downloadIcs(event) {
  const ics = buildIcsString(event);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(event.title || 'event').replace(/\s+/g, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
