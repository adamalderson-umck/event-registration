import { describe, it, expect } from 'vitest';
import { buildGoogleCalendarUrl, buildIcsString } from '../calendarLinks';

const event = {
  title: 'VBS 2026',
  description: 'Vacation Bible School',
  location: 'Fellowship Hall',
  start_date: '2026-06-15T09:00:00-04:00',
  end_date: '2026-06-15T12:00:00-04:00',
};

describe('buildGoogleCalendarUrl', () => {
  it('returns a valid Google Calendar URL', () => {
    const url = buildGoogleCalendarUrl(event);
    expect(url).toContain('https://calendar.google.com/calendar/render');
    expect(url).toContain('text=VBS+2026');
    expect(url).toContain('location=Fellowship+Hall');
  });

  it('handles missing end_date by adding 1 hour', () => {
    const url = buildGoogleCalendarUrl({ ...event, end_date: null });
    expect(url).toContain('dates=');
    // URLSearchParams encodes the '/' between start/end dates as %2F
    const decoded = decodeURIComponent(url);
    const datesMatch = decoded.match(/dates=([^&]+)/);
    expect(datesMatch).toBeTruthy();
    const parts = datesMatch[1].split('/');
    expect(parts).toHaveLength(2);
    expect(parts[1]).not.toBe(parts[0]);
  });
});

describe('buildIcsString', () => {
  it('contains VCALENDAR and VEVENT blocks', () => {
    const ics = buildIcsString(event);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:VBS 2026');
    expect(ics).toContain('LOCATION:Fellowship Hall');
    expect(ics).toContain('END:VCALENDAR');
  });
});
