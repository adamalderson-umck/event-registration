# Forms V2: Conditional Logic + Multi-Page — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add conditional show/hide logic and multi-page section breaks to the existing JSON-schema form system.

**Architecture:** Inline `condition` objects on fields + `sectionBreak` pseudo-type in the flat `form_fields` array. No database migration — the JSONB column already supports arbitrary keys. A new `formConditions.js` utility handles evaluation, a new `FormStepper.jsx` component shows page progress, and the registration form splits fields by section breaks into paginated steps.

**Tech Stack:** React 19, Tailwind CSS v4, Vitest + React Testing Library, @dnd-kit

---

## Task 1: Condition Evaluation Utility (TDD)

**Files:**
- Create: `src/utils/formConditions.js`
- Create: `src/utils/__tests__/formConditions.test.js`

### Step 1: Write the failing tests

Create `src/utils/__tests__/formConditions.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { evaluateCondition, splitIntoPages } from '../formConditions';

describe('evaluateCondition', () => {
  it('returns true when condition is null/undefined', () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition(undefined, {})).toBe(true);
  });

  it('equals — string match', () => {
    const cond = { field: 'f1', operator: 'equals', value: 'Yes' };
    expect(evaluateCondition(cond, { f1: 'Yes' })).toBe(true);
    expect(evaluateCondition(cond, { f1: 'No' })).toBe(false);
  });

  it('equals — coerces numbers to string', () => {
    const cond = { field: 'f1', operator: 'equals', value: '3' };
    expect(evaluateCondition(cond, { f1: 3 })).toBe(true);
  });

  it('equals — array value (checkboxGroup)', () => {
    const cond = { field: 'f1', operator: 'equals', value: 'Nuts' };
    expect(evaluateCondition(cond, { f1: ['Nuts', 'Dairy'] })).toBe(true);
    expect(evaluateCondition(cond, { f1: ['Dairy'] })).toBe(false);
  });

  it('notEquals — string mismatch', () => {
    const cond = { field: 'f1', operator: 'notEquals', value: 'No' };
    expect(evaluateCondition(cond, { f1: 'Yes' })).toBe(true);
    expect(evaluateCondition(cond, { f1: 'No' })).toBe(false);
  });

  it('notEquals — array value', () => {
    const cond = { field: 'f1', operator: 'notEquals', value: 'Nuts' };
    expect(evaluateCondition(cond, { f1: ['Dairy'] })).toBe(true);
    expect(evaluateCondition(cond, { f1: ['Nuts', 'Dairy'] })).toBe(false);
  });

  it('returns true for missing source field (deleted ref)', () => {
    const cond = { field: 'deleted_field', operator: 'equals', value: 'X' };
    expect(evaluateCondition(cond, {})).toBe(true);
  });

  it('returns true for unknown operator', () => {
    const cond = { field: 'f1', operator: 'startsWith', value: 'A' };
    expect(evaluateCondition(cond, { f1: 'Apple' })).toBe(true);
  });
});

describe('splitIntoPages', () => {
  it('returns single page when no section breaks', () => {
    const fields = [
      { id: 'f1', type: 'text', label: 'Name' },
      { id: 'f2', type: 'email', label: 'Email' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(1);
    expect(pages[0].fields).toHaveLength(2);
    expect(pages[0].title).toBeNull();
  });

  it('splits on sectionBreak items', () => {
    const fields = [
      { id: 'sec_1', type: 'sectionBreak', label: 'Personal' },
      { id: 'f1', type: 'text', label: 'Name' },
      { id: 'sec_2', type: 'sectionBreak', label: 'Medical' },
      { id: 'f2', type: 'textarea', label: 'Allergies' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBe('Personal');
    expect(pages[0].fields).toHaveLength(1);
    expect(pages[1].title).toBe('Medical');
    expect(pages[1].fields).toHaveLength(1);
  });

  it('handles fields before the first section break', () => {
    const fields = [
      { id: 'f0', type: 'text', label: 'Intro' },
      { id: 'sec_1', type: 'sectionBreak', label: 'Page Two' },
      { id: 'f1', type: 'text', label: 'Detail' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBeNull();
    expect(pages[0].fields).toHaveLength(1);
    expect(pages[1].title).toBe('Page Two');
  });

  it('skips empty sections', () => {
    const fields = [
      { id: 'sec_1', type: 'sectionBreak', label: 'Empty' },
      { id: 'sec_2', type: 'sectionBreak', label: 'Has Fields' },
      { id: 'f1', type: 'text', label: 'Name' },
    ];
    const pages = splitIntoPages(fields);
    // Empty section is kept (admin may add fields later)
    expect(pages).toHaveLength(2);
    expect(pages[0].fields).toHaveLength(0);
    expect(pages[1].fields).toHaveLength(1);
  });

  it('returns empty single page for empty field array', () => {
    const pages = splitIntoPages([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].fields).toHaveLength(0);
  });
});
```

### Step 2: Run tests — verify they fail

```powershell
npx vitest run src/utils/__tests__/formConditions.test.js 2>&1 | Out-File -Encoding utf8 debug/task1-step2.txt
```
Expected: FAIL (module not found)

### Step 3: Implement the utility

Create `src/utils/formConditions.js`:

```js
/**
 * Evaluates whether a field's condition is satisfied by the current form data.
 * Returns true (visible) when:
 *   - condition is null/undefined (unconditional field)
 *   - the referenced field doesn't exist in formData (deleted-ref fallback)
 *   - the operator is unrecognized (forward compatibility)
 *
 * @param {Object|null} condition  — { field, operator, value }
 * @param {Object}      formData  — { [fieldId]: value }
 * @returns {boolean}
 */
export function evaluateCondition(condition, formData) {
  if (!condition) return true;

  const actualValue = formData[condition.field];

  // Fallback: if the referenced field has no entry, treat as visible
  if (actualValue === undefined) return true;

  switch (condition.operator) {
    case 'equals':
      if (Array.isArray(actualValue)) return actualValue.includes(condition.value);
      return String(actualValue) === String(condition.value);
    case 'notEquals':
      if (Array.isArray(actualValue)) return !actualValue.includes(condition.value);
      return String(actualValue) !== String(condition.value);
    default:
      return true;
  }
}

/**
 * Splits a flat form_fields array into pages at sectionBreak items.
 * Each page is { title: string|null, fields: Field[] }.
 * Section breaks themselves are NOT included in the fields arrays.
 *
 * @param {Array} fields — the raw form_fields array from the event
 * @returns {{ title: string|null, fields: Object[] }[]}
 */
export function splitIntoPages(fields) {
  if (!fields || fields.length === 0) {
    return [{ title: null, fields: [] }];
  }

  const pages = [];
  let currentPage = { title: null, fields: [] };

  for (const field of fields) {
    if (field.type === 'sectionBreak') {
      // If we have accumulated fields (or this is a subsequent break), push
      if (pages.length > 0 || currentPage.fields.length > 0 || currentPage.title !== null) {
        pages.push(currentPage);
      }
      currentPage = { title: field.label || null, fields: [] };
    } else {
      currentPage.fields.push(field);
    }
  }

  // Push the last page
  pages.push(currentPage);

  return pages;
}
```

### Step 4: Run tests — verify they pass

```powershell
npx vitest run src/utils/__tests__/formConditions.test.js 2>&1 | Out-File -Encoding utf8 debug/task1-step4.txt
```
Expected: all PASS

### Step 5: Commit

```powershell
git add src/utils/formConditions.js src/utils/__tests__/formConditions.test.js
git commit -m "feat(forms-v2): add evaluateCondition and splitIntoPages utilities with tests"
```

---

## Task 2: Field Templates — Add `sectionBreak` Type

**Files:**
- Modify: `src/config/fieldTemplates.js:50-64`

### Step 1: Add `sectionBreak` to `fieldTypeOptions` and update `needsOptions`

In `src/config/fieldTemplates.js`, add `sectionBreak` to the `fieldTypeOptions` array and ensure `needsOptions` excludes it (it already will since 'sectionBreak' is not in the includes list):

```js
// Add after the 'radio' entry in fieldTypeOptions (line 60):
{ value: 'sectionBreak', label: 'Section Break' },
```

No change needed to `needsOptions` — it already only matches `select`, `checkboxGroup`, `radio`.

### Step 2: Run existing tests to confirm no regressions

```powershell
npx vitest run 2>&1 | Out-File -Encoding utf8 debug/task2-step2.txt
```
Expected: all PASS

### Step 3: Commit

```powershell
git add src/config/fieldTemplates.js
git commit -m "feat(forms-v2): add sectionBreak to fieldTypeOptions"
```

---

## Task 3: FormFieldBuilder — Section Break Support

**Files:**
- Modify: `src/components/FormFieldBuilder.jsx`

### Step 1: Add `addSectionBreak` function

Add alongside the existing `addField` function (after line 116):

```js
const addSectionBreak = () => {
    const newBreak = {
        id: newFieldId(),
        type: 'sectionBreak',
        label: 'New Section',
    };
    onChange([...fields, newBreak]);
    setSelectedField(newBreak);
};
```

### Step 2: Add "Add Section" button next to "Add Field"

Replace the header `div` (lines 139-144) so both buttons appear:

```jsx
<div className="flex items-center justify-between mb-4">
    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Form Fields</h3>
    <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={addSectionBreak} type="button">
            <Minus className="w-3 h-3" /> Add Section
        </Button>
        <Button variant="secondary" size="sm" onClick={addField} type="button">
            <Plus className="w-3 h-3" /> Add Field
        </Button>
    </div>
</div>
```

Add `Minus` to the lucide-react import (to use as section-break icon). Actually, use `SeparatorHorizontal` — it's more semantically appropriate:

```js
import { GripVertical, Plus, Trash2, Settings2, User, MapPin, Phone, LayoutTemplate, SeparatorHorizontal } from 'lucide-react';
```

### Step 3: Render section breaks distinctly in the `SortableField` component

Update `SortableField` to detect `sectionBreak` type and render a full-width bar:

```jsx
// Inside SortableField, after the useSortable hook and style object:
if (field.type === 'sectionBreak') {
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`
                flex items-center gap-2 p-3 rounded-lg border-2 border-dashed transition-all
                ${isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-slate-300 bg-slate-50 hover:border-slate-400'
                }
            `}
        >
            <button
                className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="w-4 h-4" />
            </button>
            <div
                className="flex-1 min-w-0 cursor-pointer flex items-center gap-2"
                onClick={() => onSelect(field)}
            >
                <SeparatorHorizontal className="w-4 h-4 text-slate-400" />
                <p className="text-sm font-semibold text-slate-600 truncate">
                    {field.label || 'Untitled Section'}
                </p>
                <span className="text-xs text-slate-400 uppercase tracking-wide">Section Break</span>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onRemove(field.id); }}
                className="text-slate-300 hover:text-danger shrink-0 cursor-pointer"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}
```

> **Note:** `SeparatorHorizontal` must be added to the lucide-react import at the top.

### Step 4: Verify visually — run `npm run dev`, create an event, add a section break

Manual check: confirm the section break appears as a dashed bar in the form builder drag-and-drop list.

### Step 5: Build check

```powershell
npx vite build 2>&1 | Out-File -Encoding utf8 debug/task3-step5.txt
```
Expected: no errors

### Step 6: Commit

```powershell
git add src/components/FormFieldBuilder.jsx
git commit -m "feat(forms-v2): add section break support to FormFieldBuilder"
```

---

## Task 4: FieldConfigPanel — Condition UI + Section Break Mode

**Files:**
- Modify: `src/components/FieldConfigPanel.jsx`

### Step 1: Add section break mode

When `field.type === 'sectionBreak'`, show only the Label input (no Type/Required/Placeholder/Options). Add an early-return branch at the top of the render:

```jsx
// After the state declarations, detect section break mode:
const isSectionBreak = config.type === 'sectionBreak';
```

Then conditionally hide Type, Required, Placeholder, and Options sections when `isSectionBreak` is true.

### Step 2: Add "Visibility" condition section for regular fields

Add below the existing "Required" checkbox (after line 84) — only shown when `!isSectionBreak`:

```jsx
{/* Visibility Condition */}
{!isSectionBreak && (
    <div className="border-t border-slate-200 pt-4 mt-4">
        <Label>Visibility</Label>
        <div className="mt-2">
            <Checkbox
                label="Always visible"
                checked={!config.condition}
                onChange={(e) => {
                    if (e.target.checked) {
                        // Remove condition
                        const { condition, ...rest } = config;
                        const updated = rest;
                        setConfig(updated);
                        onUpdate(updated);
                    } else {
                        // Add default condition
                        handleChange('condition', {
                            field: '',
                            operator: 'equals',
                            value: '',
                        });
                    }
                }}
            />
        </div>

        {config.condition && (
            <div className="mt-3 space-y-3 bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Show when…</p>

                {/* Field picker — only fields BEFORE this one */}
                <div>
                    <Label htmlFor="cond-field">Field</Label>
                    <Select
                        id="cond-field"
                        value={config.condition.field}
                        onChange={(e) => handleChange('condition', {
                            ...config.condition,
                            field: e.target.value,
                            value: '',   // reset value when field changes
                        })}
                        options={precedingFields.map((f) => ({
                            value: f.id,
                            label: f.label,
                        }))}
                        placeholder="Select field..."
                    />
                </div>

                {/* Operator */}
                <div>
                    <Label htmlFor="cond-op">Operator</Label>
                    <Select
                        id="cond-op"
                        value={config.condition.operator}
                        onChange={(e) => handleChange('condition', {
                            ...config.condition,
                            operator: e.target.value,
                        })}
                        options={[
                            { value: 'equals', label: 'Equals' },
                            { value: 'notEquals', label: 'Does not equal' },
                        ]}
                    />
                </div>

                {/* Value — dropdown if source is select/radio/checkboxGroup, text input otherwise */}
                <div>
                    <Label htmlFor="cond-value">Value</Label>
                    {sourceFieldHasOptions ? (
                        <Select
                            id="cond-value"
                            value={config.condition.value}
                            onChange={(e) => handleChange('condition', {
                                ...config.condition,
                                value: e.target.value,
                            })}
                            options={sourceFieldOptions}
                            placeholder="Select value..."
                        />
                    ) : (
                        <Input
                            id="cond-value"
                            value={config.condition.value}
                            onChange={(e) => handleChange('condition', {
                                ...config.condition,
                                value: e.target.value,
                            })}
                            placeholder="Enter value..."
                        />
                    )}
                </div>
            </div>
        )}
    </div>
)}
```

### Step 3: Wire up `precedingFields` and `allFields` props

The `FieldConfigPanel` needs to know about all fields and which ones precede the current field. **Change the component signature** to accept an `allFields` prop:

```jsx
export default function FieldConfigPanel({ field, onUpdate, onClose, allFields = [] }) {
```

Derive `precedingFields` inside the component:

```js
const fieldIndex = allFields.findIndex((f) => f.id === config.id);
const precedingFields = allFields
    .slice(0, fieldIndex)
    .filter((f) => f.type !== 'sectionBreak');

// Determine if the source field has options
const sourceField = allFields.find((f) => f.id === config.condition?.field);
const sourceFieldHasOptions = sourceField && needsOptions(sourceField.type);
const sourceFieldOptions = sourceFieldHasOptions
    ? (sourceField.options || []).map((opt) =>
        typeof opt === 'string' ? { value: opt, label: opt } : opt
    )
    : [];
```

### Step 4: Update `FormFieldBuilder.jsx` to pass `allFields` to `FieldConfigPanel`

In `FormFieldBuilder.jsx` line 199, add the `allFields` prop:

```jsx
<FieldConfigPanel
    field={selectedField}
    onUpdate={updateField}
    onClose={() => setSelectedField(null)}
    allFields={fields}
/>
```

### Step 5: Build check

```powershell
npx vite build 2>&1 | Out-File -Encoding utf8 debug/task4-step5.txt
```
Expected: no errors

### Step 6: Commit

```powershell
git add src/components/FieldConfigPanel.jsx src/components/FormFieldBuilder.jsx
git commit -m "feat(forms-v2): add condition config UI and section break mode to FieldConfigPanel"
```

---

## Task 5: FormStepper Component

**Files:**
- Create: `src/components/FormStepper.jsx`

### Step 1: Implement the stepper

Create `src/components/FormStepper.jsx`:

```jsx
import React from 'react';
import { Check } from 'lucide-react';

/**
 * Horizontal step indicator for multi-page forms.
 * Shows dots/labels with current, completed, and remaining states.
 */
export default function FormStepper({ pages, currentPage, onPageClick }) {
    if (pages.length <= 1) return null;

    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {pages.map((page, index) => {
                const isCompleted = index < currentPage;
                const isCurrent = index === currentPage;

                return (
                    <React.Fragment key={index}>
                        {index > 0 && (
                            <div
                                className={`h-0.5 w-8 transition-colors ${
                                    isCompleted ? 'bg-primary' : 'bg-slate-200'
                                }`}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => isCompleted && onPageClick(index)}
                            disabled={!isCompleted}
                            className={`
                                flex items-center justify-center w-8 h-8 rounded-full
                                text-xs font-bold transition-all shrink-0
                                ${isCurrent
                                    ? 'bg-primary text-white shadow-md'
                                    : isCompleted
                                        ? 'bg-primary/20 text-primary hover:bg-primary/30 cursor-pointer'
                                        : 'bg-slate-100 text-slate-400'
                                }
                            `}
                            title={page.title || `Step ${index + 1}`}
                        >
                            {isCompleted ? <Check className="w-3.5 h-3.5" /> : index + 1}
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    );
}
```

### Step 2: Build check

```powershell
npx vite build 2>&1 | Out-File -Encoding utf8 debug/task5-step2.txt
```
Expected: no errors

### Step 3: Commit

```powershell
git add src/components/FormStepper.jsx
git commit -m "feat(forms-v2): add FormStepper component for multi-page navigation"
```

---

## Task 6: EventRegistrationForm — Multi-Page + Conditions

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx`

This is the largest change. The form must:
1. Split fields into pages using `splitIntoPages()`
2. Track `currentPage` state
3. Evaluate conditions per field before rendering
4. Validate only current page on "Next" click
5. Strip hidden conditional fields from `form_data` on submit
6. Skip pages where all fields are conditionally hidden

### Step 1: Add imports and state

```js
import { evaluateCondition, splitIntoPages } from '../utils/formConditions';
import FormStepper from './FormStepper';
import { ChevronLeft, ChevronRight } from 'lucide-react';
```

Add state:
```js
const [currentPage, setCurrentPage] = useState(0);
```

### Step 2: Derive pages and visible fields

Below the event state, compute pages:

```js
const pages = event ? splitIntoPages(event.form_fields || []) : [];
const isMultiPage = pages.length > 1;

// Helper: determine which fields are currently visible
const getVisibleFields = (fieldsToCheck) =>
    fieldsToCheck.filter((f) => evaluateCondition(f.condition, formData));

const currentPageFields = pages[currentPage]?.fields || [];
const visibleCurrentPageFields = getVisibleFields(currentPageFields);

// All visible fields across all pages (for final submit)
const allVisibleFields = pages.flatMap((p) => getVisibleFields(p.fields));
```

### Step 3: Refactor `validate` to accept a field subset

Change the validate function to accept an optional `fieldsToValidate` argument:

```js
const validate = (fieldsToValidate = null) => {
    const newErrors = {};
    const fields = fieldsToValidate || allVisibleFields;

    for (const field of fields) {
        if (!field.required) continue;
        // ... (existing validation logic, unchanged)
    }

    // Waiver validation only on final submit (when fieldsToValidate is null)
    if (!fieldsToValidate) {
        // ... existing waiver validation ...
    }
    setWaiverErrors(fieldsToValidate ? {} : newWaiverErrors);

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
};
```

### Step 4: Add page navigation handlers

```js
const handleNext = () => {
    if (!validate(visibleCurrentPageFields)) return;

    // Find the next page with visible fields (skip all-hidden pages)
    let nextPage = currentPage + 1;
    while (nextPage < pages.length) {
        const visibleFields = getVisibleFields(pages[nextPage].fields);
        if (visibleFields.length > 0 || nextPage === pages.length - 1) break;
        nextPage++;
    }
    setCurrentPage(nextPage);
};

const handleBack = () => {
    let prevPage = currentPage - 1;
    while (prevPage >= 0) {
        const visibleFields = getVisibleFields(pages[prevPage].fields);
        if (visibleFields.length > 0) break;
        prevPage--;
    }
    setCurrentPage(Math.max(0, prevPage));
};
```

### Step 5: Update `handleSubmit` to strip hidden fields

Before inserting, build a clean `form_data` from visible fields only:

```js
// Inside handleSubmit, replace formData with cleaned version:
const cleanFormData = {};
for (const field of allVisibleFields) {
    if (formData[field.id] !== undefined) {
        cleanFormData[field.id] = formData[field.id];
    }
}
// Use cleanFormData instead of formData in registrationData
```

### Step 6: Update JSX — replace the flat field map with paginated rendering

Replace the section that currently maps over `event.form_fields` (lines 303-311) with:

```jsx
{/* Step indicator */}
{isMultiPage && (
    <FormStepper
        pages={pages}
        currentPage={currentPage}
        onPageClick={setCurrentPage}
    />
)}

{/* Page title */}
{isMultiPage && pages[currentPage]?.title && (
    <h2 className="text-lg font-semibold text-slate-800 mb-4">
        {pages[currentPage].title}
    </h2>
)}

{/* Current page fields — with condition evaluation */}
{visibleCurrentPageFields.map((field) => (
    <DynamicField
        key={field.id}
        field={field}
        value={formData[field.id]}
        onChange={handleFieldChange}
        error={errors[field.id]}
    />
))}
```

### Step 7: Update the submit/navigation buttons

Replace the single Submit button with conditional navigation:

```jsx
{/* Navigation buttons */}
<div className="flex gap-3">
    {isMultiPage && currentPage > 0 && (
        <Button
            type="button"
            variant="secondary"
            onClick={handleBack}
            className="flex-1"
            size="lg"
        >
            <ChevronLeft className="w-4 h-4" /> Back
        </Button>
    )}

    {isMultiPage && currentPage < pages.length - 1 ? (
        <Button
            type="button"
            onClick={handleNext}
            className="flex-1"
            size="lg"
        >
            Next <ChevronRight className="w-4 h-4" />
        </Button>
    ) : (
        <Button
            type="submit"
            loading={submitting}
            className="flex-1"
            size="lg"
        >
            <Send className="w-4 h-4" />
            {isFull && event.waitlist_enabled ? 'Join Waitlist' : 'Submit Registration'}
        </Button>
    )}
</div>
```

### Step 8: Reset `currentPage` in `handleReset`

```js
setCurrentPage(0);
```

### Step 9: Build check

```powershell
npx vite build 2>&1 | Out-File -Encoding utf8 debug/task6-step9.txt
```
Expected: no errors

### Step 10: Commit

```powershell
git add src/components/EventRegistrationForm.jsx
git commit -m "feat(forms-v2): multi-page navigation and conditional field rendering in EventRegistrationForm"
```

---

## Task 7: Report/Export Compatibility

**Files:**
- Modify: `src/utils/printReports.js:53-59, 82-89, 109-113`
- Modify: `src/utils/exportCsv.js:13-19`

### Step 1: Filter out `sectionBreak` items in print reports

In all functions that iterate form_fields, add a filter:

```js
const formFields = (event.form_fields || []).filter((f) => f.type !== 'sectionBreak');
```

This applies to: `printIndividualRegistration`, `printRegistrationTable`, `printSignInSheet`, `printEventSummary`.

### Step 2: Filter in CSV export

In `buildCsvString`, filter the incoming `formFields`:

```js
const filteredFields = formFields.filter((f) => f.type !== 'sectionBreak');
```

Then use `filteredFields` instead of `formFields` for headers and row generation.

### Step 3: Add test for CSV with sectionBreak fields

Add to `src/utils/__tests__/exportCsv.test.js`:

```js
it('skips sectionBreak fields in output', () => {
    const fieldsWithBreak = [
        { id: 'sec_1', type: 'sectionBreak', label: 'Section 1' },
        { id: 'f1', label: 'First Name', type: 'text' },
        { id: 'sec_2', type: 'sectionBreak', label: 'Section 2' },
        { id: 'f2', label: 'Email', type: 'email' },
    ];
    const regs = [{
        id: 'r1', status: 'confirmed', payment_status: 'paid',
        created_at: '2026-03-20T12:00:00Z',
        form_data: { f1: 'Alice', f2: 'alice@test.com' },
    }];
    const csv = buildCsvString(regs, fieldsWithBreak);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).not.toContain('Section');
    expect(headerLine).toContain('First Name');
    expect(headerLine).toContain('Email');
});
```

### Step 4: Run all tests

```powershell
npx vitest run 2>&1 | Out-File -Encoding utf8 debug/task7-step4.txt
```
Expected: all PASS

### Step 5: Commit

```powershell
git add src/utils/printReports.js src/utils/exportCsv.js src/utils/__tests__/exportCsv.test.js
git commit -m "feat(forms-v2): skip sectionBreak in print reports and CSV export"
```

---

## Task 8: Full Test Suite + Build Verification

**Files:**
- All test files
- Build output

### Step 1: Run the complete test suite

```powershell
npx vitest run 2>&1 | Out-File -Encoding utf8 debug/task8-step1.txt
```
Expected: all PASS

### Step 2: Run production build

```powershell
npx vite build 2>&1 | Out-File -Encoding utf8 debug/task8-step2.txt
```
Expected: clean build, no errors

### Step 3: Run lint

```powershell
npx eslint . 2>&1 | Out-File -Encoding utf8 debug/task8-step3.txt
```
Expected: no new warnings or errors

### Step 4: Final commit (if any linting fixes needed)

```powershell
git add -A
git commit -m "chore: lint and build verification for forms-v2"
```

---

## Verification Plan

### Automated Tests

| Command | What it verifies |
|---------|-----------------|
| `npx vitest run src/utils/__tests__/formConditions.test.js` | `evaluateCondition()` — equals, notEquals, arrays, nulls, missing fields, unknown operators |
| `npx vitest run src/utils/__tests__/formConditions.test.js` | `splitIntoPages()` — no breaks, single break, multiple breaks, empty sections, empty array |
| `npx vitest run src/utils/__tests__/exportCsv.test.js` | CSV export skips sectionBreak fields |
| `npx vitest run` | Full suite — no regressions in DynamicField, exportCsv, calendarLinks, hashContent |
| `npx vite build` | Production build compiles without errors |
| `npx eslint .` | No new lint errors |

### Manual Verification (requires running dev server and a test event)

1. **Admin: Create form with section breaks**
   - Go to event editor → form builder
   - Click "Add Section" → verify dashed bar appears
   - Add fields above and below the break
   - Drag the section break to reorder
   - Click the section break → verify FieldConfigPanel shows only Label (no Type/Required)

2. **Admin: Create conditional field**
   - Add a radio field "Has allergies?" with options "Yes" / "No"
   - Add a textarea field "Allergy details"
   - Click "Allergy details" → toggle "Always visible" off
   - Set condition: Field = "Has allergies?", Operator = "Equals", Value = "Yes"
   - Save the event

3. **Public: Multi-page form**
   - Open the event registration link
   - Verify step indicator appears (dots with numbers)
   - Fill page 1 → click "Next" → verify page 2 loads
   - Click "Back" → verify page 1 data is preserved
   - Verify "Submit" button only appears on the final page

4. **Public: Conditional field**
   - Select "No" for allergies → verify "Allergy details" is hidden
   - Select "Yes" → verify it appears
   - Submit with "No" → verify `form_data` in Supabase excludes the allergy field

5. **Reports: Section breaks skipped**
   - Print a registration report → verify no "Section Break" labels appear
   - Export CSV → verify no section break columns exist
