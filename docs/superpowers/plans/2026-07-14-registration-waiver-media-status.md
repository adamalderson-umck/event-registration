# Registration Waiver and Media Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each beta-event registrant's required-waiver status and media-release decision in the admin registrations table and the full table printout.

**Architecture:** Add one pure utility that derives the approved labels from `event.waivers` and `registration.signature_records`. Reuse that utility in `RegistrationViewer` and `printRegistrationTable` so the screen and print output share the same matching and fallback rules; the existing Supabase query and schema remain unchanged.

**Tech Stack:** React 19, JavaScript, Vitest 4, Testing Library, Supabase JavaScript client (existing read path only)

---

## File Structure

- Create `src/utils/registrationWaiverStatus.js`: pure derivation of `waiverStatus` and `mediaDecision`.
- Create `src/utils/__tests__/registrationWaiverStatus.test.js`: required, optional, missing, malformed, and contradictory-record cases.
- Modify `src/utils/printReports.js`: append Waiver and Media before Status in the full table printout.
- Create `src/utils/__tests__/printReports.test.js`: verify printed header order and row values through the generated HTML.
- Modify `src/components/RegistrationViewer.jsx`: append Waiver and Media before Status, leaving Actions last.
- Create `src/components/__tests__/RegistrationViewer.test.jsx`: verify the rendered admin table's header order and derived cell values.

The work does not add a migration, modify RLS, alter the registration fetch, or add stored status fields. The current Supabase changelog was checked on 2026-07-14; its listed breaking changes do not affect this unchanged `select('*')` read path.

### Task 1: Derive Waiver and Media Labels

**Files:**
- Create: `src/utils/registrationWaiverStatus.js`
- Test: `src/utils/__tests__/registrationWaiverStatus.test.js`

- [ ] **Step 1: Write the failing utility tests**

Create `src/utils/__tests__/registrationWaiverStatus.test.js` with:

```js
import { describe, expect, it } from 'vitest';
import { getRegistrationWaiverStatuses } from '../registrationWaiverStatus';

const liabilityWaiver = {
    id: 'waiver-liability',
    title: 'Liability Waiver',
    required: true,
};

const medicalWaiver = {
    id: 'waiver-medical',
    title: 'Medical Authorization',
    required: true,
};

const mediaRelease = {
    id: 'waiver-media',
    title: 'MEDIA RELEASE',
    required: false,
};

const optionalSurvey = {
    id: 'waiver-survey',
    title: 'Optional Survey',
    required: false,
};

function registration(signatureRecords) {
    return { signature_records: signatureRecords };
}

describe('getRegistrationWaiverStatuses', () => {
    it('returns Signed and Approved for matching signed records', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: true, declined: false },
            ]),
            [liabilityWaiver, mediaRelease]
        );

        expect(result).toEqual({
            waiverStatus: 'Signed',
            mediaDecision: 'Approved',
        });
    });

    it('requires every required waiver to be signed', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-medical', signed: true, declined: false },
            ]),
            [liabilityWaiver, medicalWaiver, optionalSurvey]
        );

        expect(result.waiverStatus).toBe('Signed');
        expect(result.mediaDecision).toBe('Missing');
    });

    it('returns Missing when any required waiver record is absent', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: true, declined: false },
            ]),
            [liabilityWaiver, medicalWaiver, mediaRelease]
        );

        expect(result).toEqual({
            waiverStatus: 'Missing',
            mediaDecision: 'Approved',
        });
    });

    it('returns Declined for an explicit media decline', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: false, declined: true },
            ]),
            [liabilityWaiver, mediaRelease]
        );

        expect(result).toEqual({
            waiverStatus: 'Signed',
            mediaDecision: 'Declined',
        });
    });

    it('returns Missing when the media definition or record is absent', () => {
        expect(
            getRegistrationWaiverStatuses(
                registration([{ waiverId: 'waiver-liability', signed: true }]),
                [liabilityWaiver, optionalSurvey]
            )
        ).toEqual({
            waiverStatus: 'Signed',
            mediaDecision: 'Missing',
        });
    });

    it('treats malformed collections as missing instead of throwing', () => {
        expect(
            getRegistrationWaiverStatuses(
                { signature_records: 'not-an-array' },
                { waivers: 'not-an-array' }
            )
        ).toEqual({
            waiverStatus: 'Missing',
            mediaDecision: 'Missing',
        });
    });

    it('gives an explicit decline precedence over a contradictory signed flag', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: true, declined: true },
            ]),
            [liabilityWaiver, mediaRelease]
        );

        expect(result.mediaDecision).toBe('Declined');
    });
});
```

- [ ] **Step 2: Run the utility test and verify RED**

Run:

```powershell
npm run test:run -- src/utils/__tests__/registrationWaiverStatus.test.js
```

Expected: FAIL because `../registrationWaiverStatus` does not exist.

- [ ] **Step 3: Implement the minimal pure utility**

Create `src/utils/registrationWaiverStatus.js` with:

```js
const MEDIA_RELEASE_TITLE = 'media release';

export function getRegistrationWaiverStatuses(registration, waivers) {
    const definitions = Array.isArray(waivers) ? waivers : [];
    const records = Array.isArray(registration?.signature_records)
        ? registration.signature_records
        : [];

    const findRecord = (waiver) => records.find(
        (record) => record?.waiverId === waiver?.id
    );

    const requiredWaivers = definitions.filter(
        (waiver) => waiver?.required !== false
    );

    const allRequiredSigned = requiredWaivers.length > 0
        && requiredWaivers.every((waiver) => {
            const record = findRecord(waiver);
            return record?.signed === true && record?.declined !== true;
        });

    const mediaWaiver = definitions.find(
        (waiver) => waiver?.required === false
            && typeof waiver.title === 'string'
            && waiver.title.trim().toLowerCase() === MEDIA_RELEASE_TITLE
    );
    const mediaRecord = mediaWaiver ? findRecord(mediaWaiver) : null;

    let mediaDecision = 'Missing';
    if (mediaRecord?.declined === true) {
        mediaDecision = 'Declined';
    } else if (mediaRecord?.signed === true) {
        mediaDecision = 'Approved';
    }

    return {
        waiverStatus: allRequiredSigned ? 'Signed' : 'Missing',
        mediaDecision,
    };
}
```

- [ ] **Step 4: Run the utility test and verify GREEN**

Run:

```powershell
npm run test:run -- src/utils/__tests__/registrationWaiverStatus.test.js
```

Expected: PASS, 1 test file and 7 tests.

- [ ] **Step 5: Commit the utility and its tests**

```powershell
git add src/utils/registrationWaiverStatus.js src/utils/__tests__/registrationWaiverStatus.test.js
git commit -m "feat: derive registration waiver statuses"
```

### Task 2: Add the Labels to the Full Table Printout

**Files:**
- Modify: `src/utils/printReports.js:1-102`
- Test: `src/utils/__tests__/printReports.test.js`

- [ ] **Step 1: Write the failing print-report test**

Create `src/utils/__tests__/printReports.test.js` with:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printRegistrationTable } from '../printReports';

describe('printRegistrationTable', () => {
    let write;

    beforeEach(() => {
        vi.useFakeTimers();
        write = vi.fn();
        vi.spyOn(window, 'open').mockReturnValue({
            document: {
                write,
                close: vi.fn(),
            },
            focus: vi.fn(),
            print: vi.fn(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('prints Waiver and Media after form fields and before Status', () => {
        const event = {
            title: 'Beta Event',
            form_fields: [
                { id: 'name', label: 'Name', type: 'text' },
                { id: 'section', label: 'Details', type: 'sectionBreak' },
            ],
            waivers: [
                { id: 'liability', title: 'Liability Waiver', required: true },
                { id: 'media', title: 'Media Release', required: false },
            ],
        };
        const registrations = [{
            id: 'registration-1',
            status: 'confirmed',
            form_data: { name: 'Alex' },
            signature_records: [
                { waiverId: 'liability', signed: true, declined: false },
                { waiverId: 'media', signed: false, declined: true },
            ],
        }];

        printRegistrationTable(registrations, event);

        const html = write.mock.calls[0][0];
        expect(html).toContain(
            '<thead><tr><th>Name</th><th>Waiver</th><th>Media</th><th>Status</th></tr></thead>'
        );
        expect(html).toContain(
            '<tr><td>Alex</td><td>Signed</td><td>Declined</td><td>confirmed</td></tr>'
        );
    });
});
```

- [ ] **Step 2: Run the print-report test and verify RED**

Run:

```powershell
npm run test:run -- src/utils/__tests__/printReports.test.js
```

Expected: FAIL because the generated table contains only the form-field headers and Status.

- [ ] **Step 3: Reuse the shared utility in the print report**

Add this import at the top of `src/utils/printReports.js`, before `printStyles`:

```js
import { getRegistrationWaiverStatuses } from './registrationWaiverStatus';
```

Replace `printRegistrationTable` with:

```js
export function printRegistrationTable(registrations, event) {
    const formFields = (event.form_fields || []).filter((f) => f.type !== 'sectionBreak');
    const headers = formFields.map((f) => `<th>${f.label}</th>`).join('');
    const derivedHeaders = '<th>Waiver</th><th>Media</th><th>Status</th>';

    const rows = registrations.map((reg) => {
        const cells = formFields.map((f) =>
            `<td>${formatValue(reg.form_data?.[f.id])}</td>`
        ).join('');
        const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(
            reg,
            event.waivers
        );
        return `<tr>${cells}<td>${waiverStatus}</td><td>${mediaDecision}</td><td>${reg.status || 'pending'}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>${event.title} - Registrations</title>${printStyles}</head><body>
    <h1>${event.title}</h1>
    <h2>Registration Table &nbsp;·&nbsp; ${registrations.length} registrations</h2>
    <table>
      <thead><tr>${headers}${derivedHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;

    openPrintWindow(html);
}
```

- [ ] **Step 4: Run the print-report test and verify GREEN**

Run:

```powershell
npm run test:run -- src/utils/__tests__/printReports.test.js
```

Expected: PASS, 1 test file and 1 test.

- [ ] **Step 5: Commit the printout change**

```powershell
git add src/utils/printReports.js src/utils/__tests__/printReports.test.js
git commit -m "feat: print registration waiver statuses"
```

### Task 3: Add the Labels to the Admin Registrations Table

**Files:**
- Modify: `src/components/RegistrationViewer.jsx:1-20,376-415`
- Test: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/__tests__/RegistrationViewer.test.jsx` with:

```jsx
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../../services/supabase', () => {
    const mockOrder = vi.fn();
    const mockSecondEq = vi.fn(() => ({ order: mockOrder }));
    const mockFirstEq = vi.fn(() => ({ eq: mockSecondEq }));
    const mockSelect = vi.fn(() => ({ eq: mockFirstEq }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    const mockSubscribe = vi.fn(() => ({ id: 'channel-1' }));
    const mockOn = vi.fn(() => ({ subscribe: mockSubscribe }));
    const mockChannel = vi.fn(() => ({ on: mockOn }));

    return {
        supabase: {
            from: mockFrom,
            channel: mockChannel,
            removeChannel: vi.fn(),
            _mocks: { mockOrder },
        },
    };
});

import RegistrationViewer from '../RegistrationViewer';
import { supabase } from '../../services/supabase';

describe('RegistrationViewer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [{
                id: 'registration-1',
                status: 'confirmed',
                form_data: { name: 'Alex' },
                signature_records: [
                    { waiverId: 'liability', signed: true, declined: false },
                    { waiverId: 'media', signed: false, declined: true },
                ],
            }],
            error: null,
        });
    });

    it('renders Waiver and Media before Status and keeps Actions last', async () => {
        const event = {
            title: 'Beta Event',
            form_fields: [{ id: 'name', label: 'Name', type: 'text' }],
            waivers: [
                { id: 'liability', title: 'Liability Waiver', required: true },
                { id: 'media', title: 'Media Release', required: false },
            ],
        };

        render(
            <RegistrationViewer
                orgId="org-1"
                eventId="event-1"
                event={event}
                onBack={vi.fn()}
            />
        );

        expect(await screen.findByText('Alex')).toBeInTheDocument();
        const table = screen.getByRole('table');
        const headers = within(table)
            .getAllByRole('columnheader')
            .map((header) => header.textContent);
        expect(headers).toEqual(['Name', 'Waiver', 'Media', 'Status', 'Actions']);

        const rows = within(table).getAllByRole('row');
        const cells = within(rows[1])
            .getAllByRole('cell')
            .map((cell) => cell.textContent.trim());
        expect(cells).toEqual(['Alex', 'Signed', 'Declined', 'confirmed', 'View']);
    });
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
npm run test:run -- src/components/__tests__/RegistrationViewer.test.jsx
```

Expected: FAIL because the admin table does not yet contain Waiver or Media columns.

- [ ] **Step 3: Import the shared utility**

Add this import after the existing utility imports in `src/components/RegistrationViewer.jsx`:

```js
import { getRegistrationWaiverStatuses } from '../utils/registrationWaiverStatus';
```

- [ ] **Step 4: Add the approved admin header order**

Replace the existing Status and Actions header block with:

```jsx
<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Waiver</th>
<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Media</th>
<th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
<th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
```

- [ ] **Step 5: Derive and render the new cells for each row**

Replace the current `filtered.map` table-body block with:

```jsx
{filtered.map((reg) => {
    const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(
        reg,
        event?.waivers
    );

    return (
        <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
            {formFields.slice(0, 5).map((field) => (
                <td key={field.id} className="px-4 py-3 text-sm text-slate-700 max-w-[200px] truncate">
                    {formatValue(getFormData(reg)[field.id])}
                </td>
            ))}
            <td className="px-4 py-3 text-sm text-slate-700">
                {waiverStatus}
            </td>
            <td className="px-4 py-3 text-sm text-slate-700">
                {mediaDecision}
            </td>
            <td className="px-4 py-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[reg.status] || statusColors.pending}`}>
                    {reg.status || 'pending'}
                </span>
            </td>
            <td className="px-4 py-3 text-right">
                <button
                    onClick={() => setSelectedReg(reg)}
                    className="text-primary hover:text-primary-dark text-sm font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                    <Eye className="w-3 h-3" /> View
                </button>
            </td>
        </tr>
    );
})}
```

- [ ] **Step 6: Run the component test and verify GREEN**

Run:

```powershell
npm run test:run -- src/components/__tests__/RegistrationViewer.test.jsx
```

Expected: PASS, 1 test file and 1 test.

- [ ] **Step 7: Commit the admin table change**

```powershell
git add src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx
git commit -m "feat: show waiver statuses in admin registrations"
```

### Task 4: Regression and Live Verification

**Files:**
- Verify only; no new files expected.

- [ ] **Step 1: Run the focused feature tests together**

Run:

```powershell
npm run test:run -- src/utils/__tests__/registrationWaiverStatus.test.js src/utils/__tests__/printReports.test.js src/components/__tests__/RegistrationViewer.test.jsx
```

Expected: PASS, 3 test files and 9 tests.

- [ ] **Step 2: Run the full automated baseline**

Run:

```powershell
npm run test:run
npm run lint
npm run build
```

Expected:

- Vitest exits 0 with the existing 94 tests plus the 9 new tests.
- ESLint exits 0 with no errors.
- Vite exits 0 and writes the production bundle to `dist/`.
- The existing intentional console error in the failed-submission test and the existing Vite large-chunk warning may still appear; neither is a new failure.

- [ ] **Step 3: Check the final diff for accidental scope expansion**

Run:

```powershell
git diff --check HEAD~3..HEAD
git status --short
```

Expected: no whitespace errors; only the six planned source/test files are part of the three implementation commits. Preserve the pre-existing user changes in `.github/workflows/ci.yml`, `src/components/TypeToSign.jsx`, and `diff.txt` without staging or modifying them.

- [ ] **Step 4: Verify the admin table against live beta-event records**

Run the app:

```powershell
npm run dev -- --host 127.0.0.1
```

In the authenticated admin UI:

1. Open the beta event's registrations table.
2. Confirm the data-column order is the existing form fields, Waiver, Media, Status, followed by Actions.
3. Open representative registrations with View and compare their signature cards with the row values:
   - all required waiver records signed displays `Waiver: Signed`;
   - an absent required record displays `Waiver: Missing`;
   - a signed Media Release displays `Media: Approved`;
   - an explicitly declined Media Release displays `Media: Declined`;
   - no matching Media Release record displays `Media: Missing`.
4. Confirm search and status filtering still leave the derived values attached to the correct rows.

Expected: the table values agree with each registration's detailed signature records and no browser console error appears.

- [ ] **Step 5: Verify the full table printout**

With the same filtered registration set, click `Table` and inspect the print preview.

Expected:

- every existing form-field column remains present;
- Waiver and Media appear immediately before Status;
- the printed values match the corresponding admin rows;
- Status is the final printed column;
- the print action does not alter the registration data or filter state.
