# Quick-Win Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement six competitive gap features (CSV export, shareable link/QR, duplicate event, add-to-calendar, registration close date, event reminder Edge Function) to reach parity with SignUpGenius/Jotform on the easiest wins.

**Architecture:** All frontend changes target existing React components. Tasks 1–4 are pure frontend (no schema or backend changes). Task 5 adds one DB column + one frontend guard. Task 6 deploys a new Supabase Edge Function reusing the existing SMTP pattern from `send-registration-email`.

**Tech Stack:** React 19, Vite, Vitest, Supabase (PostgreSQL, Edge Functions/Deno), `lucide-react` icons, Tailwind CSS v4.

---

## Task 1: CSV Export

Export filtered registrations from the admin view as a `.csv` file.

**Files:**
- Create: `src/utils/exportCsv.js`
- Create: `src/utils/__tests__/exportCsv.test.js`
- Modify: `src/components/RegistrationViewer.jsx:227-237` (print buttons toolbar)

### Step 1: Write the failing test

```js
// src/utils/__tests__/exportCsv.test.js
import { describe, it, expect } from 'vitest';
import { buildCsvString } from '../exportCsv';

describe('buildCsvString', () => {
  const fields = [
    { id: 'f1', label: 'First Name', type: 'text' },
    { id: 'f2', label: 'Email', type: 'email' },
    { id: 'f3', label: 'Allergies', type: 'checkboxGroup' },
  ];

  const registrations = [
    {
      id: 'r1', status: 'confirmed', payment_status: 'paid',
      created_at: '2026-03-20T12:00:00Z',
      form_data: { f1: 'Alice', f2: 'alice@test.com', f3: ['Peanuts', 'Gluten'] },
    },
    {
      id: 'r2', status: 'waitlisted', payment_status: 'pending',
      created_at: '2026-03-21T08:30:00Z',
      form_data: { f1: 'Bob', f2: 'bob@test.com', f3: [] },
    },
  ];

  it('produces expected CSV header row', () => {
    const csv = buildCsvString(registrations, fields);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toBe('"First Name","Email","Allergies","Status","Payment","Submitted"');
  });

  it('produces expected data rows', () => {
    const csv = buildCsvString(registrations, fields);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('"Alice"');
    expect(lines[1]).toContain('"confirmed"');
    expect(lines[1]).toContain('"Peanuts, Gluten"');
  });

  it('escapes double quotes inside values', () => {
    const regs = [{
      id: 'r3', status: 'confirmed', payment_status: 'not_required',
      created_at: '2026-03-22T10:00:00Z',
      form_data: { f1: 'Said "Hi"', f2: 'x@y.com', f3: [] },
    }];
    const csv = buildCsvString(regs, fields);
    expect(csv).toContain('"Said ""Hi"""');
  });

  it('returns only header when registrations is empty', () => {
    const csv = buildCsvString([], fields);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});
```

### Step 2: Run test to verify it fails

Run: `npx vitest run src/utils/__tests__/exportCsv.test.js`
Expected: FAIL — module `../exportCsv` not found.

### Step 3: Write minimal implementation

```js
// src/utils/exportCsv.js

/**
 * Escapes a value for CSV (RFC 4180).
 */
function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV string from registrations + form field schema.
 * Appends Status, Payment, and Submitted columns.
 */
export function buildCsvString(registrations, formFields) {
  const headers = [
    ...formFields.map((f) => f.label),
    'Status',
    'Payment',
    'Submitted',
  ];

  const rows = registrations.map((reg) => {
    const fieldValues = formFields.map((f) => {
      const val = reg.form_data?.[f.id];
      return Array.isArray(val) ? val.join(', ') : (val ?? '');
    });
    return [
      ...fieldValues,
      reg.status || '',
      reg.payment_status || '',
      reg.created_at ? new Date(reg.created_at).toLocaleString() : '',
    ];
  });

  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ];

  return csvLines.join('\n');
}

/**
 * Triggers a CSV file download in the browser.
 */
export function downloadCsv(registrations, formFields, filename = 'registrations.csv') {
  const csv = buildCsvString(registrations, formFields);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### Step 4: Run test to verify it passes

Run: `npx vitest run src/utils/__tests__/exportCsv.test.js`
Expected: PASS (4 tests).

### Step 5: Wire into RegistrationViewer

Modify `src/components/RegistrationViewer.jsx`:
- Add import: `import { downloadCsv } from '../utils/exportCsv';` and `Download` from `lucide-react`.
- In the print buttons `<div>` (around line 227), add before the existing Table button:

```jsx
<Button
  variant="secondary"
  size="sm"
  onClick={() => downloadCsv(
    filtered,
    formFields,
    `${event?.title?.replace(/\s+/g, '_') || 'registrations'}.csv`
  )}
  title="Export to CSV"
>
  <Download className="w-4 h-4" /> CSV
</Button>
```

### Step 6: Commit

```bash
git add src/utils/exportCsv.js src/utils/__tests__/exportCsv.test.js src/components/RegistrationViewer.jsx
git commit -m "feat: add CSV export for registrations"
```

---

## Task 2: Shareable Link + QR Code

Show a "Copy Link" button and QR code for each event in the admin dashboard.

**Files:**
- Install: `qrcode` (MIT license, npm package `qrcode`)
- Create: `src/components/ShareEventModal.jsx`
- Modify: `src/components/AdminDashboard.jsx:363-384` (event action buttons)

### Step 1: Install qrcode package

Run: `npm install qrcode`

License: MIT ✅

### Step 2: Create ShareEventModal

```jsx
// src/components/ShareEventModal.jsx
import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, X, QrCode } from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';

export default function ShareEventModal({ event, orgId, onClose }) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  // Build the public registration URL
  const baseUrl = window.location.origin;
  const eventUrl = `${baseUrl}/?org=${orgId}&event=${event.id}`;

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, eventUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      });
    }
  }, [eventUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = eventUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="p-6 max-w-sm w-full relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-slate-900 mb-1">Share Event</h3>
        <p className="text-sm text-slate-500 mb-4">{event.title}</p>

        <div className="flex justify-center mb-4">
          <canvas ref={canvasRef} />
        </div>

        <div className="flex gap-2">
          <input
            readOnly
            value={eventUrl}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-slate-50 truncate"
          />
          <Button size="sm" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

### Step 3: Wire into AdminDashboard

Modify `src/components/AdminDashboard.jsx`:
- Add state: `const [shareEvent, setShareEvent] = useState(null);`
- Add import: `import ShareEventModal from './ShareEventModal';` and `Share2` from `lucide-react`.
- In the event card actions div (around line 363), add a Share button before the Registrations button:

```jsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => setShareEvent(event)}
  title="Share"
>
  <Share2 className="w-4 h-4" />
</Button>
```

- After the events list `</div>` (around line 389), render the modal:

```jsx
{shareEvent && (
  <ShareEventModal
    event={shareEvent}
    orgId={currentOrg.id}
    onClose={() => setShareEvent(null)}
  />
)}
```

### Step 4: Commit

```bash
git add src/components/ShareEventModal.jsx src/components/AdminDashboard.jsx package.json package-lock.json
git commit -m "feat: add shareable link with QR code for events"
```

---

## Task 3: Duplicate Event

One-click clone an existing event in the admin dashboard.

**Files:**
- Modify: `src/components/AdminDashboard.jsx:363-384` (event action buttons)

### Step 1: Add duplicate handler

In `AdminDashboard.jsx`, add this function inside the component (after `handleSignOut`):

```js
const handleDuplicate = async (sourceEvent) => {
  try {
    const { id, created_at, updated_at, registration_count, waitlist_count, ...rest } = sourceEvent;
    const newEvent = {
      ...rest,
      title: `${sourceEvent.title} (Copy)`,
      status: 'draft',
      registration_count: 0,
      waitlist_count: 0,
    };

    const { error } = await supabase.from('events').insert(newEvent);
    if (error) throw error;
    // Realtime subscription will auto-add the new event to the list
  } catch (err) {
    console.error('Error duplicating event:', err);
    alert('Failed to duplicate event');
  }
};
```

### Step 2: Add duplicate button to event card

In the event card actions div (around line 363), add after the Share button:

```jsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => handleDuplicate(event)}
  title="Duplicate"
>
  <Copy className="w-4 h-4" />
</Button>
```

Add `Copy` to the existing `lucide-react` import.

### Step 3: Commit

```bash
git add src/components/AdminDashboard.jsx
git commit -m "feat: add duplicate event action"
```

---

## Task 4: Add to Calendar

Show "Add to Google Calendar" and "Download .ics" links on the post-registration success screen and in the confirmation email.

**Files:**
- Create: `src/utils/calendarLinks.js`
- Create: `src/utils/__tests__/calendarLinks.test.js`
- Modify: `src/components/SuccessState.jsx` (add calendar buttons)
- Modify Edge Function: `send-registration-email/index.ts` (add calendar link in confirmation email)

### Step 1: Write the failing test

```js
// src/utils/__tests__/calendarLinks.test.js
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
```

### Step 2: Run test to verify it fails

Run: `npx vitest run src/utils/__tests__/calendarLinks.test.js`
Expected: FAIL — module `../calendarLinks` not found.

### Step 3: Write minimal implementation

```js
// src/utils/calendarLinks.js

/**
 * Formats a Date to Google Calendar's UTC format: YYYYMMDDTHHmmssZ
 */
function toGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
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
  const start = new Date(event.start_date);
  const end = event.end_date
    ? new Date(event.end_date)
    : new Date(start.getTime() + 60 * 60 * 1000); // default 1h

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || '',
    dates: `${toGoogleDate(start)}/${toGoogleDate(end)}`,
    details: event.description || '',
    location: event.location || '',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Builds a downloadable .ics string (RFC 5545).
 */
export function buildIcsString(event) {
  const start = new Date(event.start_date);
  const end = event.end_date
    ? new Date(event.end_date)
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
```

### Step 4: Run test to verify it passes

Run: `npx vitest run src/utils/__tests__/calendarLinks.test.js`
Expected: PASS (3 tests).

### Step 5: Add calendar buttons to SuccessState

Modify `src/components/SuccessState.jsx`:
- Accept `event` prop (entire event object instead of just `eventTitle`).
- Add imports and render calendar buttons below the confirmation text, before "Register Another":

```jsx
import { buildGoogleCalendarUrl, downloadIcs } from '../utils/calendarLinks';
import { Calendar } from 'lucide-react';

// Inside the component, after the confirmation text <p> and before "Register Another":
{event?.start_date && (
  <div className="flex justify-center gap-3 mb-6">
    <a
      href={buildGoogleCalendarUrl(event)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
    >
      <Calendar className="w-4 h-4" /> Google Calendar
    </a>
    <button
      onClick={() => downloadIcs(event)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline cursor-pointer"
    >
      <Calendar className="w-4 h-4" /> Download .ics
    </button>
  </div>
)}
```

Also update `EventRegistrationForm.jsx` to pass the full `event` object to `SuccessState` instead of just `event?.title`.

### Step 6: Add calendar link to confirmation email

Re-deploy the `send-registration-email` Edge Function with a Google Calendar link appended to the confirmation email body (INSERT handler, confirmed path). Insert after the cancel link section:

```html
<p style="font-size:13px;color:#94a3b8;margin-top:16px;">Add to your calendar:</p>
<a href="${googleCalUrl}" style="color:#2563eb;font-size:13px;text-decoration:underline;" target="_blank">Add to Google Calendar</a>
```

Where `googleCalUrl` is built using the same logic as `buildGoogleCalendarUrl` but inline in Deno.

### Step 7: Commit

```bash
git add src/utils/calendarLinks.js src/utils/__tests__/calendarLinks.test.js src/components/SuccessState.jsx src/components/EventRegistrationForm.jsx
git commit -m "feat: add-to-calendar on success screen and confirmation email"
```

---

## Task 5: Registration Close Date

Auto-close registration based on a configurable cutoff date.

**Files:**
- Migration: add `registration_close_date` column to `events`
- Modify: `src/components/EventEditor.jsx:272-281` (add close date field)
- Modify: `src/components/EventRegistrationForm.jsx:46-50` (add close-date guard)
- Modify: `src/components/EventCard.jsx` (show close-date info if set)

### Step 1: Apply migration

```sql
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_close_date timestamptz;
```

### Step 2: Add close date field to EventEditor

In `src/components/EventEditor.jsx`:
- Add `registrationCloseDate: ''` to the initial state object (around line 32).
- In `fetchEvent`, map `data.registration_close_date` to state (around line 69-70).
- In `handleSave`, add `registration_close_date: event.registrationCloseDate || null` to `eventData`.
- In the date grid (around line 272), add a third field:

```jsx
<div>
  <Label htmlFor="event-close">Registration Closes</Label>
  <Input
    id="event-close"
    type="datetime-local"
    value={event.registrationCloseDate}
    onChange={(e) => handleChange('registrationCloseDate', e.target.value)}
  />
  <p className="text-xs text-slate-400 mt-1">Leave empty for manual control via status</p>
</div>
```

Change the grid from `grid-cols-2` to `grid-cols-3` for this row.

### Step 3: Add close-date guard to registration form

In `src/components/EventRegistrationForm.jsx`, after the `status !== 'active'` check (around line 46), add:

```js
// Auto-closed by registration_close_date
if (data.registration_close_date && new Date(data.registration_close_date) < new Date()) {
  setFetchError('Registration for this event has closed');
  setLoading(false);
  return;
}
```

### Step 4: Commit

```bash
git add src/components/EventEditor.jsx src/components/EventRegistrationForm.jsx
git commit -m "feat: add registration close date with auto-close guard"
```

---

## Task 6: Pre-Event Reminder Edge Function

Send automated reminder emails to confirmed registrants before an event starts.

**Files:**
- Migration: add `reminder_hours_before` column to `events`
- Migration: add `reminder_sent_at` column to `events` (prevent duplicate sends)
- Create & Deploy: `send-event-reminders` Edge Function (scheduled cron)

### Step 1: Apply migration

```sql
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reminder_hours_before integer,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
```

### Step 2: Add reminder config to EventEditor

In `src/components/EventEditor.jsx`:
- Add `reminderHoursBefore: ''` to state.
- Map in `fetchEvent`: `reminderHoursBefore: data.reminder_hours_before != null ? String(data.reminder_hours_before) : ''`.
- Add to `eventData` in `handleSave`: `reminder_hours_before: event.reminderHoursBefore ? parseInt(event.reminderHoursBefore) : null`.
- Add UI in the Notifications card (around line 373), after the weekly digest section:

```jsx
<div className="flex items-center gap-3">
  <Label htmlFor="reminder-hours" className="whitespace-nowrap text-sm">
    Send reminder
  </Label>
  <Input
    id="reminder-hours"
    type="number"
    min="1"
    value={event.reminderHoursBefore}
    onChange={(e) => handleChange('reminderHoursBefore', e.target.value)}
    placeholder="e.g. 24"
    className="w-24"
  />
  <span className="text-sm text-slate-500">hours before event</span>
</div>
```

### Step 3: Create Edge Function

The `send-event-reminders` Edge Function queries for events that:
1. Have `status = 'active'`
2. Have a non-null `reminder_hours_before`
3. Have `start_date` within the reminder window (now → now + reminder_hours_before)
4. Have `reminder_sent_at IS NULL` (not yet sent)

For each matching event, it fetches all confirmed registrations, sends a reminder email using the org's SMTP config (reusing the same `emailjs` pattern from `send-registration-email`), then sets `reminder_sent_at = now()`.

This function should be deployed with `verify_jwt: false` and invoked via Supabase `pg_cron` or an external CRON service hitting the function URL.

```typescript
// send-event-reminders/index.ts  (key logic sketch)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "npm:emailjs@4";

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Find events due for reminder
  const now = new Date();
  const { data: events } = await supabase
    .from("events")
    .select("*, organizations!events_org_id_fkey(*)")
    .eq("status", "active")
    .not("reminder_hours_before", "is", null)
    .not("start_date", "is", null)
    .is("reminder_sent_at", null);

  let sent = 0;
  for (const event of events || []) {
    const reminderTime = new Date(
      new Date(event.start_date).getTime() -
        event.reminder_hours_before * 60 * 60 * 1000,
    );

    // Only send if we've passed the reminder threshold
    if (now < reminderTime) continue;

    const org = event.organizations;
    const smtpConfig = org?.smtp_config;
    if (!smtpConfig?.host) continue;

    // Fetch confirmed registrations
    const { data: regs } = await supabase
      .from("registrations")
      .select("*")
      .eq("event_id", event.id)
      .eq("status", "confirmed");

    if (!regs || regs.length === 0) continue;

    const formFields = (event.form_fields || []);
    const emailField = formFields.find((f: any) => f.type === "email");

    const client = new SMTPClient({
      host: smtpConfig.host,
      port: smtpConfig.port || 465,
      ssl: (smtpConfig.port || 465) === 465,
      user: smtpConfig.auth?.user,
      password: smtpConfig.auth?.pass,
    });

    const eventDate = new Date(event.start_date).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const eventTime = new Date(event.start_date).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
    });

    for (const reg of regs) {
      const email = emailField ? reg.form_data?.[emailField.id] : null;
      if (!email) continue;

      const html = `<!-- reminder email HTML using same wrapEmail pattern -->`;

      await client.sendAsync({
        from: `"${smtpConfig.fromName || org.name}" <${smtpConfig.fromEmail}>`,
        to: email,
        subject: `Reminder: ${event.title} is coming up!`,
        attachment: [{ data: html, alternative: true }],
      });
      sent++;
    }

    // Mark reminder as sent
    await supabase
      .from("events")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", event.id);
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

### Step 4: Deploy Edge Function

Deploy via `mcp_supabase_deploy_edge_function` with `verify_jwt: false` (invoked by cron, not user).

### Step 5: Commit

```bash
git add src/components/EventEditor.jsx
git commit -m "feat: add pre-event reminder Edge Function and admin config"
```

---

## Verification Plan

### Automated Tests

| Test | Command | Expected |
|------|---------|----------|
| CSV Export | `npx vitest run src/utils/__tests__/exportCsv.test.js` | 4 tests pass |
| Calendar Links | `npx vitest run src/utils/__tests__/calendarLinks.test.js` | 3 tests pass |
| Full Suite | `npx vitest run` | All tests pass, no regressions |
| Build Check | `npx vite build` | Clean build, no warnings |

### Manual Browser Verification

1. **CSV Export:** Admin dashboard → select an event → Registrations → click "CSV" button → `.csv` file downloads and opens correctly in Excel/Sheets.
2. **Shareable Link + QR:** Admin dashboard → click Share icon on any event → modal shows QR code + copyable URL → paste URL in incognito → registration form loads.
3. **Duplicate Event:** Admin dashboard → click Copy icon on an event → new event "(Copy)" appears in draft status with same form fields, capacity, waiver settings, but zero registrations.
4. **Add to Calendar:** Submit a registration → success screen shows "Google Calendar" + "Download .ics" links → Google Calendar link opens pre-filled event → .ics downloads and opens in calendar app.
5. **Registration Close Date:** Admin → edit event → set Registration Closes to a past date → save → visit public form → shows "Registration for this event has closed" message.
6. **Pre-Event Reminder:** Set a `reminder_hours_before` on an event whose `start_date` is within the window → invoke the Edge Function URL manually → check SMTP logs or mailbox for the reminder email.
