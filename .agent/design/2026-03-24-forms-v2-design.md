# Forms V2: Conditional Logic + Multi-Page

## Problem

The current form system renders all fields in a single flat list with no way to:
1. Show/hide fields based on a registrant's prior answers (e.g., "Show allergy details only if 'Has allergies?' = Yes")
2. Break long forms into multiple pages/sections with step navigation (e.g., VBS registration with personal info → emergency contacts → waivers)

Both SignUpGenius and Jotform support these features. Our gap analysis ranked them as medium-effort enhancements.

## Current Architecture

**Schema:** `events.form_fields` is a flat JSON array:
```json
[
  { "id": "field_1", "type": "text", "label": "Name", "required": true },
  { "id": "field_2", "type": "radio", "label": "Has allergies?", "options": ["Yes", "No"] },
  { "id": "field_3", "type": "textarea", "label": "Allergy details" }
]
```

**Key components:**
- `DynamicField.jsx` — renders a single field by type (10 types)
- `FormFieldBuilder.jsx` — admin drag-and-drop field list with @dnd-kit
- `FieldConfigPanel.jsx` — right panel for editing label/type/required/options
- `fieldTemplates.js` — template groups (Name, Address, Contact Info)
- `EventRegistrationForm.jsx` — public form that maps over `form_fields` and renders `DynamicField` for each

## Design Decisions

### Decision 1: How to represent conditions in the schema

**Recommended: Inline condition property on each field**

Add an optional `condition` object to any field:
```json
{
  "id": "field_3",
  "type": "textarea",
  "label": "Allergy details",
  "condition": {
    "field": "field_2",
    "operator": "equals",
    "value": "Yes"
  }
}
```

**Why this over alternatives:**
- **vs. separate conditions array:** Inline keeps each field self-contained — no cross-referencing. When a field is dragged, deleted, or duplicated, its condition moves with it.
- **vs. rule engine:** Way too complex for simple show/hide. YAGNI.
- **Backward compatible:** Fields without `condition` render unconditionally (current behavior).

**Operators for V1:** `equals`, `notEquals`
**Future V2 operators:** `contains`, `isEmpty`, `isNotEmpty`, `greaterThan`, `lessThan`

---

### Decision 2: How to represent sections/pages in the schema

**Recommended: Section break pseudo-field type**

Insert a `sectionBreak` item into the existing flat field array:
```json
[
  { "id": "sec_1", "type": "sectionBreak", "label": "Personal Information" },
  { "id": "field_1", "type": "text", "label": "Name" },
  { "id": "field_2", "type": "email", "label": "Email" },
  { "id": "sec_2", "type": "sectionBreak", "label": "Medical Information" },
  { "id": "field_3", "type": "radio", "label": "Has allergies?", "options": ["Yes", "No"] },
  { "id": "field_4", "type": "textarea", "label": "Allergy details", "condition": { "field": "field_3", "operator": "equals", "value": "Yes" } }
]
```

**Why this over alternatives:**
- **vs. nested sections array:** Restructuring `form_fields` from flat → nested is a breaking change. Every consumer (registration form, print reports, CSV export, email templates, admin reports) would need to be rewritten. The flat array with markers avoids this.
- **vs. separate pages column:** Introduces schema coupling between two columns. The flat array is self-describing.
- **Drag-and-drop compatible:** Section breaks are just items in the `@dnd-kit` sortable list — admins can reorder them like any other field.
- **Backward compatible:** Forms without `sectionBreak` items render as a single page (current behavior).

**Rendering logic:** The registration form splits the flat array on `sectionBreak` items, creating an array of pages. A step indicator shows progress. Next/Back buttons navigate between pages. Per-page validation runs before advancing.

---

### Decision 3: Validation behavior across pages

Each page validates its own visible, required fields independently:
- **Next button** validates current page fields only — won't advance if required fields are empty
- **Back button** always works (no validation)
- **Conditional fields that are hidden** are excluded from validation and from `form_data` on submit
- **Final Submit** runs one more full validation pass across all pages

---

## Schema Changes

No database migration needed. The `form_fields` column is already `jsonb` — we're just adding optional keys (`condition`, `sectionBreak` type) to the existing objects.

## Component Changes

### New Files
| File | Purpose |
|------|---------|
| `src/utils/formConditions.js` | `evaluateCondition(condition, formData)` — returns boolean |
| `src/utils/__tests__/formConditions.test.js` | Unit tests for condition evaluation |
| `src/components/FormStepper.jsx` | Step indicator bar (dots or numbered steps) |

### Modified Files
| File | Change |
|------|--------|
| `FieldConfigPanel.jsx` | Add "Show when..." section: field picker dropdown, operator selector, value input |
| `FormFieldBuilder.jsx` | Add "Section Break" option to the Add Field button; render section breaks distinctly (full-width bar instead of field card) |
| `fieldTemplates.js` | Add `sectionBreak` to `fieldTypeOptions`; exclude it from `needsOptions` |
| `DynamicField.jsx` | No change — section breaks are not rendered by DynamicField |
| `EventRegistrationForm.jsx` | Split fields by `sectionBreak` into pages; add Next/Back/Submit navigation; evaluate conditions before rendering each field; per-page validation |
| `printReports.js` | Skip `sectionBreak` items in report generation |
| `exportCsv.js` | Skip `sectionBreak` items in CSV column generation |

### Data Flow

```
Admin builds form                    Registrant fills form
┌─────────────────┐                  ┌──────────────────┐
│ FormFieldBuilder │                  │ EventRegistration │
│   + section      │                  │    Form.jsx      │
│     breaks       │ ──form_fields──▶ │                  │
│   + conditions   │    (jsonb)       │ splitIntoPages() │
│ FieldConfigPanel │                  │ evaluateCondition│
│   + "Show when"  │                  │ FormStepper      │
└─────────────────┘                  │ Next / Back      │
                                     └──────────────────┘
```

## Condition Evaluation Logic

```js
function evaluateCondition(condition, formData) {
  if (!condition) return true; // no condition = always visible

  const actualValue = formData[condition.field];

  switch (condition.operator) {
    case 'equals':
      // Handle array values (checkboxGroup)
      if (Array.isArray(actualValue)) return actualValue.includes(condition.value);
      return String(actualValue) === String(condition.value);
    case 'notEquals':
      if (Array.isArray(actualValue)) return !actualValue.includes(condition.value);
      return String(actualValue) !== String(condition.value);
    default:
      return true;
  }
}
```

## Multi-Page UX

1. **Step indicator** — horizontal dots/labels at the top showing current page, completed pages, and remaining
2. **Per-page rendering** — only the current page's fields are visible; conditional fields within the page are evaluated in real-time
3. **Navigation** — "Next" (validates current page), "Back" (no validation), "Submit" (final page only)
4. **Single-page fallback** — forms with no `sectionBreak` items render exactly as today (no stepper, no navigation)
5. **Progress preservation** — form data persists in React state across page navigation; no data loss on Back

## Admin Builder UX

### Condition Configuration (FieldConfigPanel)
When editing any field, a new "Visibility" section appears:
- **Toggle:** "Always visible" (default) vs. "Show when..."
- **Field picker:** Dropdown of all fields defined *before* this one in the list (prevents circular references)
- **Operator:** "equals" / "does not equal"
- **Value:** Text input, or dropdown of options if the source field is select/radio/checkboxGroup

### Section Breaks (FormFieldBuilder)
- **Add Section** button alongside "Add Field" 
- Section breaks render as a full-width divider bar with an editable title
- Draggable like any other item
- Can be deleted (merges the sections above and below)
- FieldConfigPanel shows only label/title when a section break is selected (no type/required/placeholder)

## Edge Cases

| Case | Behavior |
|------|----------|
| Condition references a deleted field | Treat as "always visible" (fallback) |
| Condition references a field on a later page | Not allowed — field picker only shows preceding fields |
| Required field is conditionally hidden | Skip validation; exclude from `form_data` on submit |
| All fields on a page are conditionally hidden | Skip that page automatically |
| Form has section breaks but only one section | Render as single page (no stepper) |
| Existing forms (no conditions, no sections) | Render identically to current behavior |

## Testing Strategy

### Unit Tests
- `evaluateCondition()` — equals, notEquals, array values, missing field, null condition
- `splitIntoPages()` — no breaks, single break, multiple breaks, empty sections

### Component Tests
- `FieldConfigPanel` — condition UI appears when "Show when" is toggled, field picker excludes current field
- `EventRegistrationForm` — multi-page navigation, per-page validation, conditional hide/show, hidden fields excluded from submission

### Manual
- Create a form with section breaks → verify multi-page rendering with step indicator
- Add conditions → verify fields show/hide based on answers
- Submit → verify hidden conditional fields are excluded from `form_data`
- Print report / CSV export → verify section breaks are skipped gracefully
