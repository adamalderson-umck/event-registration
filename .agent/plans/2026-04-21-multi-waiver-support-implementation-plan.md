# Multi-Waiver Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-waiver event model with an ordered array of independent waivers, each with its own title, content, `required` flag, and separate signature record — enabling events like VBS to collect both a Liability Waiver (required) and a Media Release (optional, with explicit accept/decline).

**Architecture:** Keep waiver *definitions* as a JSONB array column (`waivers`) on the `events` table (same pattern as `form_fields`). Store each waiver *signature* as an element of a `signature_records` JSONB array on `registrations`. This avoids new tables and new RLS policies while achieving full legal separation.

**Tech Stack:** React 19, Tailwind CSS v4, Vite, Supabase PostgreSQL, pdf-lib, @dnd-kit/sortable, Vitest/RTL

**Branch:** `feature/multi-waiver-support`

---

## Key Domain Decisions (from user)

1. **Media releases require an explicit "I decline" action** — not just leaving it unsigned. Radio-style: `○ I agree to sign  ○ I decline`. Decline is recorded as `signed: false, declined: true`.
2. **No org-level waiver templates** — waiver text is per-event. Event duplication is the reuse mechanism.
3. **Required waivers block submission**; optional waivers accept `declined` as a valid terminal state.

---

## Data Model Reference

### `events.waivers` (new JSONB column, replaces flat waiver_ columns)

```json
[
  {
    "id": "w_abc123",
    "title": "Liability Waiver & Hold Harmless",
    "content": "<p>By registering...</p>",
    "contentHash": "a1b2c3...",
    "required": true,
    "order": 0
  },
  {
    "id": "w_def456",
    "title": "Media Release",
    "content": "<p>I authorize...</p>",
    "contentHash": "d4e5f6...",
    "required": false,
    "order": 1
  }
]
```

### `registrations.signature_records` (new JSONB column, replaces singular `signature_record`)

```json
[
  {
    "waiverId": "w_abc123",
    "waiverTitle": "Liability Waiver & Hold Harmless",
    "waiverContentHash": "a1b2c3...",
    "signed": true,
    "declined": false,
    "signedAt": "2026-04-21T14:00:00Z",
    "signerName": "Jane Doe",
    "signatureMethod": "draw",
    "signatureData": "data:image/png;base64,...",
    "signatureFont": null,
    "ipAddress": "1.2.3.4",
    "userAgent": "Mozilla/5.0...",
    "consentToESign": true
  },
  {
    "waiverId": "w_def456",
    "waiverTitle": "Media Release",
    "waiverContentHash": "d4e5f6...",
    "signed": false,
    "declined": true,
    "signedAt": "2026-04-21T14:00:01Z",
    "signerName": "Jane Doe",
    "signatureMethod": null,
    "signatureData": null,
    "signatureFont": null,
    "ipAddress": "1.2.3.4",
    "userAgent": "Mozilla/5.0...",
    "consentToESign": false
  }
]
```

---

## Task 1: Database Migration

**Files:**
- Create: `scripts/migrate-waivers.sql`

### Step 1: Write the migration SQL

```sql
-- scripts/migrate-waivers.sql
-- Multi-waiver support migration
-- Run against production Supabase via the SQL editor (Dashboard → SQL Editor)

-- 1. Add new waivers array column to events
ALTER TABLE events ADD COLUMN IF NOT EXISTS waivers jsonb DEFAULT '[]';

-- 2. Migrate existing single-waiver data to the new array format
UPDATE events
SET waivers = CASE
  WHEN waiver_enabled = true AND (waiver_title IS NOT NULL OR waiver_content IS NOT NULL)
  THEN jsonb_build_array(jsonb_build_object(
    'id',          'w_migrated_' || id::text,
    'title',       COALESCE(waiver_title, ''),
    'content',     COALESCE(waiver_content, ''),
    'contentHash', COALESCE(waiver_content_hash, ''),
    'required',    true,
    'order',       0
  ))
  ELSE '[]'
END
WHERE waivers = '[]';

-- 3. Add new signature_records array column to registrations
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS signature_records jsonb DEFAULT '[]';

-- 4. Migrate existing single signature_record to the array format
UPDATE registrations
SET signature_records = CASE
  WHEN signature_record IS NOT NULL AND signature_record != 'null'::jsonb
    AND (signature_record->>'signed')::boolean = true
  THEN jsonb_build_array(
    signature_record || jsonb_build_object(
      'waiverId', 'w_migrated_' || event_id::text,
      'declined', false
    )
  )
  ELSE '[]'
END
WHERE signature_records = '[]';
```

### Step 2: Run the migration in Supabase SQL Editor

1. Go to: Supabase Dashboard → SQL Editor
2. Paste and run `scripts/migrate-waivers.sql`
3. Verify: `SELECT id, waivers FROM events WHERE waiver_enabled = true LIMIT 5;`
4. Verify: `SELECT id, signature_records FROM registrations WHERE signature_record IS NOT NULL LIMIT 5;`

> **DO NOT drop the old columns yet.** They'll be removed in Task 9 (cleanup) after all code is deployed and verified.

### Step 3: Commit

```bash
git add scripts/migrate-waivers.sql
git commit -m "feat: add multi-waiver migration SQL"
```

---

## Task 2: `sha256` Utility Verification

**Files:**
- Read: `src/utils/hashContent.js`

### Step 1: Verify the existing `sha256` export

Check that `src/utils/hashContent.js` exports a `sha256(string): Promise<string>` function. This is already used by `EventEditor.jsx` to hash a single waiver. It will be reused to hash each waiver in the array.

```bash
# Expected output: exports sha256
grep -n "export" src/utils/hashContent.js
```

No changes needed if the function exists. If it doesn't exist, create it:

```js
// src/utils/hashContent.js
export async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

---

## Task 3: `WaiverSection.jsx` — Admin Multi-Waiver Editor

Replace the existing single-panel waiver editor with a sortable list of waiver cards.

**Files:**
- Modify: `src/components/WaiverSection.jsx`

### Step 1: Write the test first

```jsx
// src/components/__tests__/WaiverSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// DnD kit needs a mock browser environment — just stub it out
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(),
    transform: null, transition: null,
  }),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: (arr, from, to) => {
    const next = [...arr];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  },
}));
vi.mock('../WaiverEditor', () => ({
  default: ({ content, onChange }) => (
    <textarea data-testid="waiver-editor" value={content} onChange={e => onChange(e.target.value)} />
  ),
}));

import WaiverSection from '../WaiverSection';

describe('WaiverSection', () => {
  it('renders "Add Waiver" button when waivers is empty', () => {
    render(<WaiverSection waivers={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/add waiver/i)).toBeInTheDocument();
  });

  it('calls onChange with a new waiver when "Add Waiver" is clicked', () => {
    const onChange = vi.fn();
    render(<WaiverSection waivers={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText(/add waiver/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: '', required: true }),
      ])
    );
  });

  it('renders a waiver card for each waiver', () => {
    const waivers = [
      { id: 'w1', title: 'Liability Waiver', content: '', contentHash: '', required: true, order: 0 },
      { id: 'w2', title: 'Media Release', content: '', contentHash: '', required: false, order: 1 },
    ];
    render(<WaiverSection waivers={waivers} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Liability Waiver')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Media Release')).toBeInTheDocument();
  });

  it('calls onChange without the deleted waiver on delete click', () => {
    const onChange = vi.fn();
    const waivers = [
      { id: 'w1', title: 'Liability Waiver', content: '', contentHash: '', required: true, order: 0 },
    ];
    render(<WaiverSection waivers={waivers} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /delete waiver/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/components/__tests__/WaiverSection.test.jsx
```

Expected: FAIL — `WaiverSection` still has old API (`waiver`, `onChange({enabled, title, content})`).

### Step 3: Implement new `WaiverSection.jsx`

```jsx
// src/components/WaiverSection.jsx
import React, { lazy, Suspense } from 'react';
import { FileSignature, GripVertical, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Checkbox from './ui/Checkbox';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';
import Button from './ui/Button';

const WaiverEditor = lazy(() => import('./WaiverEditor'));

function SortableWaiverCard({ waiver, onChange, onDelete }) {
  const {
    attributes, listeners, setNodeRef, transform, transition,
  } = useSortable({ id: waiver.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <div className="flex-1 space-y-3">
          {/* Title */}
          <div>
            <Label htmlFor={`waiver-title-${waiver.id}`}>Waiver Title</Label>
            <Input
              id={`waiver-title-${waiver.id}`}
              value={waiver.title}
              onChange={(e) => onChange({ ...waiver, title: e.target.value })}
              placeholder="e.g. Liability Waiver & Hold Harmless"
            />
          </div>

          {/* Required toggle */}
          <Checkbox
            label="Required (blocks form submission if not signed)"
            checked={waiver.required}
            onChange={(e) => onChange({ ...waiver, required: e.target.checked })}
          />

          {/* Content editor */}
          <div>
            <Label>Waiver Content</Label>
            <Suspense fallback={
              <div className="flex justify-center py-8 border border-slate-300 rounded-lg">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            }>
              <WaiverEditor
                content={waiver.content}
                onChange={(html) => onChange({ ...waiver, content: html })}
              />
            </Suspense>
          </div>
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete waiver"
          className="text-slate-300 hover:text-red-500 transition-colors mt-1"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function WaiverSection({ waivers = [], onChange }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = waivers.findIndex((w) => w.id === active.id);
    const newIndex = waivers.findIndex((w) => w.id === over.id);
    onChange(arrayMove(waivers, oldIndex, newIndex).map((w, i) => ({ ...w, order: i })));
  };

  const handleAdd = () => {
    const newWaiver = {
      id: `w_${Date.now()}`,
      title: '',
      content: '',
      contentHash: '',
      required: true,
      order: waivers.length,
    };
    onChange([...waivers, newWaiver]);
  };

  const handleChange = (id, updated) => {
    onChange(waivers.map((w) => (w.id === id ? updated : w)));
  };

  const handleDelete = (id) => {
    onChange(waivers.filter((w) => w.id !== id));
  };

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <FileSignature className="w-5 h-5 text-primary" />
        Waivers / E-Sign
      </h3>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={waivers.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3 mb-4">
            {waivers.map((waiver) => (
              <SortableWaiverCard
                key={waiver.id}
                waiver={waiver}
                onChange={(updated) => handleChange(waiver.id, updated)}
                onDelete={() => handleDelete(waiver.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button type="button" variant="secondary" onClick={handleAdd} className="w-full">
        <Plus className="w-4 h-4" /> Add Waiver
      </Button>
    </Card>
  );
}
```

### Step 4: Run tests to verify they pass

```bash
npx vitest run src/components/__tests__/WaiverSection.test.jsx
```

Expected: PASS (4 tests)

### Step 5: Commit

```bash
git add src/components/WaiverSection.jsx src/components/__tests__/WaiverSection.test.jsx
git commit -m "feat: multi-waiver admin editor (WaiverSection)"
```

---

## Task 4: `EventEditor.jsx` — Wire Up New Waivers Array

**Files:**
- Modify: `src/components/EventEditor.jsx`

### Step 1: Update initial state (line ~74)

Change:
```js
waiver: {
    enabled: false,
    title: '',
    content: '',
},
```
To:
```js
waivers: [],
```

### Step 2: Update the data load block (lines ~131–135)

Change:
```js
waiver: {
    enabled: !!data.waiver_enabled,
    title: data.waiver_title || '',
    content: data.waiver_content || '',
},
```
To:
```js
waivers: Array.isArray(data.waivers) ? data.waivers : [],
```

### Step 3: Update `handleSave` (lines ~241–246)

Remove:
```js
waiver_enabled: event.waiver.enabled,
waiver_title: event.waiver.enabled ? event.waiver.title.trim() : '',
waiver_content: event.waiver.enabled ? event.waiver.content : '',
waiver_content_hash: event.waiver.enabled
    ? await sha256(event.waiver.content)
    : '',
```

Replace with (hash each waiver in the array):
```js
waivers: await Promise.all(
    event.waivers.map(async (w, i) => ({
        ...w,
        title: w.title.trim(),
        contentHash: await sha256(w.content),
        order: i,
    }))
),
```

### Step 4: Update the WaiverSection usage in JSX (line ~569)

Change:
```jsx
<WaiverSection
    waiver={event.waiver}
    onChange={(waiver) => handleChange('waiver', waiver)}
/>
```
To:
```jsx
<WaiverSection
    waivers={event.waivers}
    onChange={(waivers) => handleChange('waivers', waivers)}
/>
```

### Step 5: Run existing tests to verify no regressions

```bash
npx vitest run
```

Expected: All tests pass.

### Step 6: Commit

```bash
git add src/components/EventEditor.jsx
git commit -m "feat: wire waivers[] array into EventEditor"
```

---

## Task 5: `FormPreviewPane.jsx` — Synthetic Event Shape

**Files:**
- Modify: `src/components/FormPreviewPane.jsx`

### Step 1: Update the `syntheticEvent` memo (lines ~19–35)

Change:
```js
waiver_enabled: eventState.waiver?.enabled || false,
waiver_title: eventState.waiver?.title || '',
waiver_content: eventState.waiver?.content || '',
```
To:
```js
waivers: eventState.waivers || [],
```

### Step 2: Run tests

```bash
npx vitest run src/components/__tests__/FormPreview.test.jsx
```

Expected: All pass. The `waiver_enabled` test will need updating (see Task 8).

### Step 3: Commit

```bash
git add src/components/FormPreviewPane.jsx
git commit -m "feat: FormPreviewPane passes waivers[] to preview"
```

---

## Task 6: `WaiverSignatureStep.jsx` — Per-Waiver Signature UI

This is the **core public-facing change**. Each waiver gets its own signature block.

**Files:**
- Modify: `src/components/WaiverSignatureStep.jsx`

The component's public API changes from:
```jsx
<WaiverSignatureStep waiver={event} value={waiverData} onChange={...} errors={...} />
```
To accepting a single waiver definition + its individual state:
```jsx
<WaiverSignatureStep waiver={waiverDef} value={sigState} onChange={...} errors={...} required={waiverDef.required} />
```

### Step 1: Update the component

```jsx
// src/components/WaiverSignatureStep.jsx
import React, { useState, lazy, Suspense } from 'react';
import { FileSignature, Pen, Type, Loader2 } from 'lucide-react';
import Checkbox from './ui/Checkbox';
import Input from './ui/Input';
import Label from './ui/Label';
import TypeToSign from './TypeToSign';

const SignaturePad = lazy(() => import('./SignaturePad'));

/**
 * Renders the signature UI for a single waiver.
 *
 * @param {object} waiver - The waiver definition { id, title, content, required }
 * @param {object} value  - Current sig state { consentToESign, declined, signerName, signatureMethod, signatureData, signatureFont }
 * @param {function} onChange - Called with updated sig state
 * @param {object} errors - Validation errors { consentToESign, signerName, signature }
 */
export default function WaiverSignatureStep({ waiver, value, onChange, errors }) {
    const [activeTab, setActiveTab] = useState(value?.signatureMethod || 'draw');
    const isRequired = waiver.required !== false; // default to required if unset

    const handleChange = (key, val) => {
        const updated = { ...value, [key]: val };
        if (key === 'signatureMethod') {
            if (val === 'draw') {
                updated.signatureFont = null;
            } else {
                updated.signatureData = null;
                updated.signatureFont = "'Dancing Script', cursive";
            }
        }
        onChange(updated);
    };

    const handleTabSwitch = (tab) => {
        setActiveTab(tab);
        handleChange('signatureMethod', tab);
    };

    // When user clicks decline, clear any signature data and set declined flag
    const handleDecline = () => {
        onChange({
            consentToESign: false,
            declined: true,
            signerName: value?.signerName || '',
            signatureMethod: 'draw',
            signatureData: null,
            signatureFont: null,
        });
    };

    const handleAccept = () => {
        onChange({
            ...value,
            declined: false,
            consentToESign: false, // still need to check the box
        });
    };

    return (
        <div className="space-y-4 border border-slate-200 rounded-xl p-5 bg-slate-50/50">
            {/* Header */}
            <div className="flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold text-slate-900">
                    {waiver.title || 'Waiver Agreement'}
                    {!isRequired && (
                        <span className="ml-2 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Optional</span>
                    )}
                </h3>
            </div>

            {/* Waiver Text (scrollable) */}
            <div
                className="bg-white border border-slate-200 rounded-lg p-4 max-h-72 overflow-y-auto prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: waiver.content }}
            />

            {/* Accept / Decline for optional waivers */}
            {!isRequired && (
                <div className="flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name={`waiver-decision-${waiver.id}`}
                            checked={!value?.declined}
                            onChange={handleAccept}
                            className="text-primary"
                        />
                        <span className="text-sm font-medium text-slate-700">I agree to sign</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name={`waiver-decision-${waiver.id}`}
                            checked={!!value?.declined}
                            onChange={handleDecline}
                            className="text-primary"
                        />
                        <span className="text-sm font-medium text-slate-700">I decline</span>
                    </label>
                </div>
            )}

            {/* Signature section — shown when not declined */}
            {!value?.declined && (
                <>
                    {/* E-Sign Consent */}
                    <div>
                        <Checkbox
                            label="I agree to sign this document electronically"
                            checked={!!value?.consentToESign}
                            onChange={(e) => handleChange('consentToESign', e.target.checked)}
                        />
                        {errors?.consentToESign && (
                            <p className="text-xs text-danger mt-1">{errors.consentToESign}</p>
                        )}
                    </div>

                    {/* Signer Name */}
                    <div>
                        <Label htmlFor={`signer-name-${waiver.id}`} required>Full Legal Name</Label>
                        <Input
                            id={`signer-name-${waiver.id}`}
                            value={value?.signerName || ''}
                            onChange={(e) => handleChange('signerName', e.target.value)}
                            placeholder="Enter your full legal name"
                            error={errors?.signerName}
                            disabled={!value?.consentToESign}
                        />
                    </div>

                    {/* Draw / Type Toggle */}
                    <div>
                        <Label>Signature</Label>
                        <div className="flex border border-slate-300 rounded-lg overflow-hidden mb-3">
                            <button
                                type="button"
                                onClick={() => handleTabSwitch('draw')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${activeTab === 'draw' ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                <Pen className="w-4 h-4" /> Draw
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTabSwitch('type')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${activeTab === 'type' ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                <Type className="w-4 h-4" /> Type
                            </button>
                        </div>

                        {activeTab === 'draw' ? (
                            <Suspense fallback={
                                <div className="flex justify-center py-12 border border-slate-300 rounded-lg">
                                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                                </div>
                            }>
                                <SignaturePad
                                    onChange={(data) => handleChange('signatureData', data)}
                                    disabled={!value?.consentToESign}
                                />
                            </Suspense>
                        ) : (
                            <TypeToSign name={value?.signerName || ''} />
                        )}

                        {errors?.signature && (
                            <p className="text-xs text-danger mt-1">{errors.signature}</p>
                        )}
                    </div>

                    <p className="text-xs text-slate-400 text-right">
                        {value?.consentToESign
                            ? `Signing at: ${new Date().toLocaleString()}`
                            : 'Review and accept the agreement above to sign'}
                    </p>
                </>
            )}

            {/* Declined state */}
            {value?.declined && (
                <p className="text-sm text-slate-500 italic">
                    You have declined this waiver. Your decision has been recorded.
                </p>
            )}
        </div>
    );
}
```

### Step 2: Run existing tests

```bash
npx vitest run
```

Expected: All existing tests pass (this component has no dedicated tests yet).

### Step 3: Commit

```bash
git add src/components/WaiverSignatureStep.jsx
git commit -m "feat: WaiverSignatureStep supports required/optional and explicit decline"
```

---

## Task 7: `EventRegistrationForm.jsx` — Multi-Waiver State & Validation

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx`

### Step 1: Replace single `waiverData` state with a map keyed by waiver ID

Change (lines ~21–28):
```js
const [waiverData, setWaiverData] = useState({
    consentToESign: false,
    signerName: '',
    signatureMethod: 'draw',
    signatureData: null,
    signatureFont: null,
});
const [waiverErrors, setWaiverErrors] = useState({});
```
To:
```js
// Map of { [waiverId]: { consentToESign, declined, signerName, signatureMethod, signatureData, signatureFont } }
const [waiverDataMap, setWaiverDataMap] = useState({});
const [waiverErrorsMap, setWaiverErrorsMap] = useState({});
```

### Step 2: Replace waiver validation logic (lines ~182–198)

Change:
```js
// Waiver validation — only on final submit (fieldsToValidate is null)
const newWaiverErrors = {};
if (!fieldsToValidate && event?.waiver_enabled) {
    if (!waiverData.consentToESign) { ... }
    if (!waiverData.signerName?.trim()) { ... }
    if (waiverData.signatureMethod === 'draw' && !waiverData.signatureData) { ... }
}
setWaiverErrors(fieldsToValidate ? {} : newWaiverErrors);
```
To:
```js
// Multi-waiver validation — only on final submit
const newWaiverErrorsMap = {};
const waiverDefs = event?.waivers || [];
if (!fieldsToValidate && waiverDefs.length > 0) {
    for (const waiver of waiverDefs) {
        const sigState = waiverDataMap[waiver.id] || {};
        const wErr = {};

        // If declined, optional waivers are valid; required ones are not
        if (sigState.declined) {
            if (waiver.required) {
                newErrors[`_waiver_declined_${waiver.id}`] = 'required_declined';
                wErr.declined = 'This waiver is required and cannot be declined.';
            }
            // Optional + declined => valid
        } else {
            // Not declined — must have proper signature
            if (!sigState.consentToESign) {
                newErrors[`_waiver_consent_${waiver.id}`] = 'consent';
                wErr.consentToESign = 'You must agree to sign electronically';
            }
            if (!sigState.signerName?.trim()) {
                newErrors[`_waiver_name_${waiver.id}`] = 'name';
                wErr.signerName = 'Full legal name is required';
            }
            if (sigState.signatureMethod === 'draw' && !sigState.signatureData) {
                newErrors[`_waiver_sig_${waiver.id}`] = 'signature';
                wErr.signature = 'Please draw your signature';
            }
        }

        if (Object.keys(wErr).length > 0) {
            newWaiverErrorsMap[waiver.id] = wErr;
        }
    }
}
setWaiverErrorsMap(fieldsToValidate ? {} : newWaiverErrorsMap);
```

### Step 3: Replace signature build logic in `handleSubmit` (lines ~276–305)

Change:
```js
if (event.waiver_enabled) {
    let ipAddress = 'unknown';
    // ...
    registrationData.signature_record = { ... };
}
```
To:
```js
const waiverDefs = event?.waivers || [];
if (waiverDefs.length > 0) {
    let ipAddress = 'unknown';
    try {
        const response = await supabase.functions.invoke('capture-signer-ip');
        if (response.data?.ip) ipAddress = response.data.ip;
    } catch (err) {
        console.warn('Could not capture IP:', err);
    }

    registrationData.signature_records = waiverDefs.map((waiver) => {
        const sigState = waiverDataMap[waiver.id] || {};
        const declined = !!sigState.declined;
        return {
            waiverId: waiver.id,
            waiverTitle: waiver.title || '',
            waiverContentHash: waiver.contentHash || '',
            signed: !declined,
            declined,
            signedAt: new Date().toISOString(),
            signerName: sigState.signerName?.trim() || '',
            signerEmail: findRegistrantEmail(event.form_fields, formData),
            signatureMethod: declined ? null : (sigState.signatureMethod || 'draw'),
            signatureData: declined ? null : (sigState.signatureMethod === 'draw' ? sigState.signatureData : null),
            signatureFont: declined ? null : (sigState.signatureMethod === 'type' ? sigState.signatureFont : null),
            ipAddress,
            userAgent: navigator.userAgent,
            consentToESign: !declined,
        };
    });
}
```

### Step 4: Replace the `waiverSlot` prop (lines ~406–420)

Change:
```jsx
waiverSlot={
    event.waiver_enabled
        ? (
            <WaiverSignatureStep
                waiver={event}
                value={waiverData}
                onChange={(data) => { setWaiverData(data); setWaiverErrors({}); }}
                errors={waiverErrors}
            />
        )
        : null
}
```
To:
```jsx
waiverSlot={
    (event.waivers?.length > 0)
        ? (
            <div className="space-y-4">
                {event.waivers.map((waiver) => (
                    <WaiverSignatureStep
                        key={waiver.id}
                        waiver={waiver}
                        value={waiverDataMap[waiver.id] || {}}
                        onChange={(data) => {
                            setWaiverDataMap((prev) => ({ ...prev, [waiver.id]: data }));
                            setWaiverErrorsMap((prev) => { const n = { ...prev }; delete n[waiver.id]; return n; });
                        }}
                        errors={waiverErrorsMap[waiver.id] || {}}
                    />
                ))}
            </div>
        )
        : null
}
```

### Step 5: Update `handleReset` to clear new state

Change:
```js
setWaiverData({ consentToESign: false, signerName: '', signatureMethod: 'draw', signatureData: null, signatureFont: null });
setWaiverErrors({});
```
To:
```js
setWaiverDataMap({});
setWaiverErrorsMap({});
```

### Step 6: Run all tests

```bash
npx vitest run
```

Expected: All pass. (The existing `EventRegistrationForm.test.jsx` uses `waiver_enabled: false` events so no waiver path is exercised and no changes are needed to those tests.)

### Step 7: Add a test for multi-waiver submission

Add to `src/components/__tests__/EventRegistrationForm.test.jsx`:

```js
it('includes signature_records[] when event has waivers', async () => {
    const waiverEvent = makeEvent({
        waivers: [
            { id: 'w1', title: 'Liability', content: '<p>test</p>', contentHash: 'abc', required: true, order: 0 },
        ],
    });
    setupMocks(waiverEvent);
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await userEvent.type(await screen.findByLabelText(/first name/i), 'John');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Doe');
    await userEvent.type(screen.getByLabelText(/email/i), 'john@example.com');

    // Check the e-sign consent box
    fireEvent.click(screen.getByLabelText(/agree to sign.*electronically/i));
    // Type a name
    await userEvent.type(screen.getByLabelText(/full legal name/i), 'John Doe');

    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    await waitFor(() => {
        expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
            signature_records: expect.arrayContaining([
                expect.objectContaining({ waiverId: 'w1', signed: true }),
            ]),
        }));
    });
});
```

### Step 8: Run all tests

```bash
npx vitest run
```

Expected: All pass.

### Step 9: Commit

```bash
git add src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx
git commit -m "feat: multi-waiver state, validation, and submission in EventRegistrationForm"
```

---

## Task 8: `FormPreview.jsx` — Update Preview Placeholder

**Files:**
- Modify: `src/components/FormPreview.jsx`

### Step 1: Find the waiver placeholder (around line 220)

Find:
```jsx
{isLastPage && readOnly && event.waiver_enabled && !waiverSlot && (
    <p>...Waiver section will appear here...</p>
)}
```

Change to:
```jsx
{isLastPage && readOnly && event.waivers?.length > 0 && !waiverSlot && (
    <div className="border border-dashed border-slate-300 rounded-xl p-4 text-sm text-slate-400 text-center space-y-1">
        <p className="font-medium">
            {event.waivers.length === 1
                ? 'Waiver section will appear here'
                : `${event.waivers.length} Waiver sections will appear here`}
        </p>
        {event.waivers.map((w) => (
            <p key={w.id} className="text-xs">
                • {w.title || 'Untitled Waiver'}{w.required ? '' : ' (optional)'}
            </p>
        ))}
    </div>
)}
```

Also update the `baseEvent` synthetic shape check — search for any other `event.waiver_enabled` references in this file and update to `event.waivers?.length > 0`.

### Step 2: Update `FormPreview.test.jsx` — adapt the waiver placeholder test

Change:
```js
it('shows waiver placeholder in readOnly mode when waiver is enabled', () => {
    const waiverEvent = {
        ...baseEvent,
        waiver_enabled: true,
    };
    render(<FormPreview event={waiverEvent} readOnly={true} />);
    expect(screen.getByText(/Waiver.*section will appear here/i)).toBeInTheDocument();
});
```
To:
```js
it('shows waiver placeholder in readOnly mode when event has waivers', () => {
    const waiverEvent = {
        ...baseEvent,
        waivers: [{ id: 'w1', title: 'Liability Waiver', content: '', required: true, order: 0 }],
    };
    render(<FormPreview event={waiverEvent} readOnly={true} />);
    expect(screen.getByText(/Waiver.*section will appear here/i)).toBeInTheDocument();
});

it('shows count when multiple waivers configured', () => {
    const waiverEvent = {
        ...baseEvent,
        waivers: [
            { id: 'w1', title: 'Liability Waiver', content: '', required: true, order: 0 },
            { id: 'w2', title: 'Media Release', content: '', required: false, order: 1 },
        ],
    };
    render(<FormPreview event={waiverEvent} readOnly={true} />);
    expect(screen.getByText(/2 Waiver sections will appear here/i)).toBeInTheDocument();
});
```

Remove `waiver_enabled: false` from `baseEvent` in that test file, replacing with `waivers: []`.

### Step 3: Run all tests

```bash
npx vitest run
```

Expected: All pass.

### Step 4: Commit

```bash
git add src/components/FormPreview.jsx src/components/__tests__/FormPreview.test.jsx
git commit -m "feat: FormPreview placeholder supports waivers[]"
```

---

## Task 9: `SignatureViewer.jsx` — Multiple PDF Pages

**Files:**
- Modify: `src/components/SignatureViewer.jsx`

The component currently receives `registration` and `event`, reads a single `registration.signatureRecord`, and generates a single-page PDF. Update to iterate `registration.signature_records[]`, generating a PDF page per waiver.

### Step 1: Update the component

Key changes:
1. `const sig = registration.signatureRecord` → `const records = registration.signature_records || []`
2. Guard: `if (!sig?.signed) return null` → `if (records.length === 0) return null`
3. `generateSignedWaiverPdf` accepts `records[]` and an `event` for waiver content lookup, loops over records adding one page per waiver
4. The download filename uses the event title

```jsx
// src/components/SignatureViewer.jsx
import React, { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Download, CheckCircle2, XCircle } from 'lucide-react';
import Button from './ui/Button';

async function addWaiverPage(pdfDoc, font, fontBold, sig, waiverContent) {
    let page = pdfDoc.addPage([612, 792]); // US Letter
    const fontSize = 10;
    let y = 740;
    const leftMargin = 50;
    const maxWidth = 512;

    // Title
    page.drawText(sig.waiverTitle || 'Waiver Agreement', {
        x: leftMargin, y, font: fontBold, size: 18, color: rgb(0.06, 0.09, 0.16),
    });
    y -= 10;

    // Required / Optional badge
    const badgeText = sig.declined ? '[DECLINED]' : '[SIGNED]';
    page.drawText(badgeText, {
        x: leftMargin, y, font, size: 10,
        color: sig.declined ? rgb(0.9, 0.2, 0.2) : rgb(0.1, 0.6, 0.3),
    });
    y -= 30;

    // Waiver content (strip HTML)
    const plainText = (waiverContent || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const words = plainText.split(' ');
    let line = '';
    for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > maxWidth && line) {
            page.drawText(line, { x: leftMargin, y, font, size: fontSize });
            y -= 15;
            line = word;
            if (y < 200) {
                page = pdfDoc.addPage([612, 792]);
                y = 740;
            }
        } else {
            line = testLine;
        }
    }
    if (line) { page.drawText(line, { x: leftMargin, y, font, size: fontSize }); y -= 30; }

    // Separator
    page.drawLine({
        start: { x: leftMargin, y: y + 5 },
        end: { x: leftMargin + maxWidth, y: y + 5 },
        color: rgb(0.8, 0.8, 0.8), thickness: 0.5,
    });
    y -= 10;

    if (!sig.declined) {
        // Embed signature
        if (sig.signatureMethod === 'draw' && sig.signatureData) {
            try {
                const pngBytes = Uint8Array.from(atob(sig.signatureData.split(',')[1]), (c) => c.charCodeAt(0));
                const pngImage = await pdfDoc.embedPng(pngBytes);
                const scale = Math.min(200 / pngImage.width, 60 / pngImage.height);
                page.drawImage(pngImage, { x: leftMargin, y: y - 60, width: pngImage.width * scale, height: pngImage.height * scale });
                y -= 70;
            } catch (err) {
                console.warn('Could not embed signature image:', err);
            }
        } else if (sig.signatureMethod === 'type') {
            page.drawText(sig.signerName || '', { x: leftMargin, y: y - 20, font, size: 22, color: rgb(0.06, 0.09, 0.16) });
            y -= 40;
        }
    }

    // Audit details
    y -= 10;
    const details = [
        `Signer: ${sig.signerName || 'N/A'}`,
        `Email: ${sig.signerEmail || 'N/A'}`,
        `Date: ${sig.signedAt ? new Date(sig.signedAt).toLocaleString() : 'N/A'}`,
        `Decision: ${sig.declined ? 'Declined' : `Signed (${sig.signatureMethod === 'draw' ? 'drawn' : 'typed'})`}`,
        `IP Address: ${sig.ipAddress || 'N/A'}`,
        `Content Hash: ${sig.waiverContentHash || 'N/A'}`,
    ];
    for (const detail of details) {
        page.drawText(detail, { x: leftMargin, y, font, size: 8, color: rgb(0.4, 0.4, 0.4) });
        y -= 12;
    }

    y -= 10;
    page.drawText('Electronically signed via Event Registration System', {
        x: leftMargin, y, font, size: 7, color: rgb(0.6, 0.6, 0.6),
    });
}

async function generateSignedWaiversPdf(registration, event) {
    const records = registration.signature_records || [];
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (const sig of records) {
        // Look up waiver content from event definition by matching waiverId
        const waiverDef = (event.waivers || []).find((w) => w.id === sig.waiverId);
        await addWaiverPage(pdfDoc, font, fontBold, sig, waiverDef?.content || '');
    }

    return await pdfDoc.save();
}

export default function SignatureViewer({ registration, event }) {
    const [downloading, setDownloading] = useState(false);
    const records = registration.signature_records || [];

    if (records.length === 0) return null;

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const pdfBytes = await generateSignedWaiversPdf(registration, event);
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `waivers-${event?.title?.replace(/\s+/g, '-') || 'signed'}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('PDF generation error:', err);
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="border border-green-200 bg-green-50/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Waiver Records</span>
                <Button variant="secondary" size="sm" onClick={handleDownload} loading={downloading}>
                    <Download className="w-3 h-3" /> Download PDF
                </Button>
            </div>

            {records.map((sig) => (
                <div key={sig.waiverId} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                        {sig.signed
                            ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                            : <XCircle className="w-4 h-4 text-slate-300 shrink-0" />}
                        <span className="text-sm font-medium text-slate-900">
                            {sig.waiverTitle || 'Waiver'}
                            {sig.declined && <span className="ml-2 text-xs text-red-500 font-normal">(Declined)</span>}
                        </span>
                    </div>

                    {!sig.declined && (
                        <div className="pl-6">
                            {sig.signatureMethod === 'draw' && sig.signatureData ? (
                                <img src={sig.signatureData} alt="Signature" className="max-h-12 object-contain" />
                            ) : (
                                <p className="text-lg text-slate-900" style={{ fontFamily: sig.signatureFont || "'Dancing Script', cursive" }}>
                                    {sig.signerName}
                                </p>
                            )}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-400 mt-1">
                                <span>Signer: {sig.signerName}</span>
                                <span>IP: {sig.ipAddress || 'N/A'}</span>
                                <span>Date: {sig.signedAt ? new Date(sig.signedAt).toLocaleString() : 'N/A'}</span>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
```

### Step 2: Update `RegistrationViewer.jsx` — display condition (line ~202)

Change:
```jsx
{selectedReg.signature_record?.signed && (
    <div className="mt-4">
        <SignatureViewer registration={selectedReg} event={event} />
    </div>
)}
```
To:
```jsx
{(selectedReg.signature_records?.length > 0) && (
    <div className="mt-4">
        <SignatureViewer registration={selectedReg} event={event} />
    </div>
)}
```

### Step 3: Run all tests

```bash
npx vitest run
```

Expected: All pass.

### Step 4: Commit

```bash
git add src/components/SignatureViewer.jsx src/components/RegistrationViewer.jsx
git commit -m "feat: SignatureViewer renders per-waiver records with decline support"
```

---

## Task 10: Run Migration & Smoke Test

### Step 1: Apply the migration

Run `scripts/migrate-waivers.sql` in the Supabase SQL Editor.

### Step 2: Build and deploy

```bash
npm run build
firebase deploy --only hosting
```

### Step 3: Smoke test checklist

**Admin flow:**
- [ ] Open EventEditor for an existing event — "Waivers" card shows existing migrated waiver
- [ ] Add a second waiver titled "Media Release", mark as optional, save
- [ ] Open EventEditor for a new event — add one required + one optional waiver, save
- [ ] Reordering waivers via drag-and-drop updates persist on reload

**Registrant flow:**
- [ ] Open the registration form for the new event
- [ ] Both waiver blocks appear at the bottom of the form
- [ ] Required waiver: cannot submit without signing
- [ ] Optional waiver: can select "I decline" and still submit
- [ ] Submit → check Supabase dashboard → `signature_records` array has both entries

**Admin view:**
- [ ] View the registration detail → "Waiver Records" section shows both waivers
- [ ] Signed waiver shows signature preview + audit details
- [ ] Declined waiver shows the "(Declined)" label
- [ ] Download PDF → PDF has one page per waiver

### Step 4: Final commit

```bash
git add -p  # stage any last changes
git commit -m "feat: complete multi-waiver support"
```

---

## Task 11: Old Column Cleanup (deferred — after production verification)

> Run this only after confirming the deployed feature works correctly under production traffic.

```sql
-- Run in Supabase SQL Editor after full verification
ALTER TABLE events
    DROP COLUMN IF EXISTS waiver_enabled,
    DROP COLUMN IF EXISTS waiver_title,
    DROP COLUMN IF EXISTS waiver_content,
    DROP COLUMN IF EXISTS waiver_content_hash;

ALTER TABLE registrations
    DROP COLUMN IF EXISTS signature_record;
```

Then commit the cleanup.

---

## Verification Plan

### Automated Tests

```bash
npx vitest run                       # all unit tests must pass
npx vitest run --coverage            # confirm coverage hasn't regressed significantly
```

### Manual Verification

See Task 10 smoke test checklist above.
