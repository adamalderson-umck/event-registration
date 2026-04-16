# WYSIWYG Form Preview — Design Doc

## Goal

Add a live preview pane to the admin form builder that renders the public registration form *exactly* as registrants will see it — including header image, theme colors, stepper, and conditional fields — updating in real-time as fields are configured.

## Architecture

### Approach: Extract → Reuse

`EventRegistrationForm.jsx` (503 lines) currently interleaves data-fetching, validation, submission, and rendering. We cannot pass it a mock event for preview without triggering side effects.

**Strategy:** Extract the *rendering-only* portion of `EventRegistrationForm` into a new `FormPreview` component that accepts a synthetic event object as a prop. Both the public form and the admin preview will consume this component, ensuring pixel-perfect parity.

### Component Hierarchy

```
EventEditor.jsx
├── ...existing sections...
├── <h3>Registration Form Fields</h3>
│   └── <FormFieldBuilder />       (existing — field list + config panel)
└── <h3>Live Preview</h3>          (NEW — collapsible section)
    └── <FormPreviewPane />        (NEW — wrapper)
        └── <FormPreview />        (NEW — pure presentational renderer)

EventRegistrationForm.jsx          (existing — refactored)
└── <FormPreview />                (reuses same component)
```

### New Components

#### 1. `FormPreview.jsx` — Pure Presentational Renderer

Extracted from lines 312-500 of `EventRegistrationForm.jsx`. Accepts props:

| Prop | Type | Description |
|------|------|-------------|
| `event` | Object | Synthetic event with title, description, location, start_date, form_fields, theme, header_image_url, waiver_enabled, capacity, etc. |
| `formData` | Object | Current field values (empty `{}` in preview) |
| `currentPage` | number | Active page index |
| `readOnly` | boolean | When `true`, disables all inputs and hides submit button |

This component renders:
- Header (image-based or gradient) with title, description, date, location
- `FormStepper` (when multi-page)
- Page title
- Two-column `DynamicField` grid with condition evaluation
- Waiver placeholder (when enabled)
- Navigation/submit buttons (disabled in read-only mode)

#### 2. `FormPreviewPane.jsx` — Admin Preview Wrapper

Wraps `FormPreview` with:
- A collapsible section toggle (collapsed by default to save viewport space)
- Builds a synthetic event object from `EventEditor` state
- Manages its own `currentPage` state so admin can click through pages
- Subtle "Preview" badge + border styling to distinguish from actual form
- Scaled-down rendering (CSS `transform: scale(0.8)` in a container) so it doesn't dominate the editor

### Refactored Component

#### 3. `EventRegistrationForm.jsx` — Refactored

The data-fetching, validation, and submission logic stays. The JSX rendering (lines 312-500) is replaced with:

```jsx
<FormPreview
  event={event}
  formData={formData}
  currentPage={currentPage}
  readOnly={false}
/>
```

With event handlers still wired to the parent's state. `FormPreview` will accept optional callback props (`onFieldChange`, `onNext`, `onBack`, `onSubmit`) that the public form provides but preview mode omits.

## Data Flow

```
EventEditor state (event.formFields, event.theme, event.headerImageUrl, ...)
  ↓ builds synthetic event object
FormPreviewPane
  ↓ passes event + readOnly=true + formData={}
FormPreview
  ↓ renders exactly like public form
DynamicField × N (all disabled)
```

## Scope Boundaries

**In scope (MVP):**
- Exact visual parity with public form  
- Header image + theme colors
- Multi-page stepper with clickable navigation in preview
- Conditional field visibility (fields with met conditions shown)
- Read-only inputs (disabled, no validation)
- Collapsible section in EventEditor

**Out of scope:**
- Interactive fields (typing into preview)
- Waiver signature rendering (show placeholder "Waiver section will appear here")
- Payment section preview
- Mobile responsive preview (phone-frame mockup)
