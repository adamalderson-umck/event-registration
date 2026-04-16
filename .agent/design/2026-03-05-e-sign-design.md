# E-Sign Feature — Design Document

## Overview

Add inline waiver/media-release e-sign capability to the event registration flow. Organizers author waiver text in a rich text editor inside the Event Editor. Registrants review and sign the waiver (draw or type-to-sign) as part of the registration form before submitting. A complete audit trail is captured for legal enforceability. Admins can view signed waivers and download them as PDFs.

---

## 1. Data Model

### Event Document (`organizations/{orgId}/events/{eventId}`)

New fields added to the existing event document:

```js
{
  // ...existing fields (title, description, formFields, etc.)

  waiverEnabled: true,               // boolean — toggle in Event Editor
  waiverTitle: "Media Release",       // string — display title
  waiverContent: "<p>I hereby...</p>", // string (HTML) — rich text body
  waiverContentHash: "sha256:abc...", // string — SHA-256 of waiverContent at save time
}
```

### Registration Document (`organizations/{orgId}/registrations/{regId}`)

New `signatureRecord` field added to registration data:

```js
{
  // ...existing fields (eventId, formData, status, etc.)

  signatureRecord: {
    signed: true,                      // boolean
    signedAt: Timestamp,               // Firestore server timestamp
    signerName: "Jane Doe",            // string — typed full name (always captured)
    signerEmail: "jane@example.com",   // string — from registration form data
    signatureMethod: "draw",           // "draw" | "typed"
    signatureData: "data:image/png;base64,...", // string — draw: canvas PNG as data URL; typed: null
    signatureFont: null,               // string | null — typed: font family name; draw: null

    // Audit trail
    waiverTitle: "Media Release",      // string — snapshot of waiver title at sign time
    waiverContentHash: "sha256:abc...",// string — hash of waiver content signed
    ipAddress: "203.0.113.42",         // string — captured via Cloud Function
    userAgent: "Mozilla/5.0...",       // string — navigator.userAgent
    consentToESign: true,              // boolean — explicit checkbox acknowledgment
  }
}
```

> **Why snapshot the hash?** If the org edits the waiver text after someone signed it, the hash proves exactly which version was signed.

---

## 2. Architecture — Component Map

```
EventEditor.jsx
└── [NEW] WaiverSection.jsx           ← Toggle + rich text editor (TipTap)

EventRegistrationForm.jsx
└── [NEW] WaiverSignatureStep.jsx     ← Waiver display + signature capture
    ├── [NEW] SignaturePad.jsx        ← Draw-on-canvas (signature_pad lib)
    └── [NEW] TypeToSign.jsx          ← Typed name in cursive font

RegistrationViewer.jsx
└── [NEW] SignatureViewer.jsx         ← View signature + download PDF

Cloud Functions
└── [NEW] captureSignerIp             ← Callable function to return client IP
```

---

## 3. Admin Authoring — WaiverSection

A new collapsible Card section in `EventEditor.jsx` (placed between Notifications and Form Fields):

- **Enable waiver** checkbox — toggles `waiverEnabled`
- **Waiver title** text input — e.g., "Media Release", "Liability Waiver"
- **Waiver content** — TipTap rich text editor with basic toolbar:
  - Bold, italic, underline
  - Bullet list, ordered list
  - Heading levels (H2, H3)
  - No image/file upload (keep it lightweight)
- On event save, compute SHA-256 hash of `waiverContent` and store as `waiverContentHash`

### TipTap Choice Rationale

- MIT licensed, zero vulnerabilities
- Headless (render your own UI) — matches the project's custom component style
- Lightweight — only import the extensions you need
- React-first with `@tiptap/react`

---

## 4. Registration Flow — WaiverSignatureStep

When `event.waiverEnabled === true`, a new section appears in the registration form **after all dynamic form fields and before the submit button**:

### Layout

```
┌──────────────────────────────────────┐
│  📋 Media Release                    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Waiver text rendered as HTML  │  │
│  │  (scrollable container,        │  │
│  │   max-height: 300px)           │  │
│  └────────────────────────────────┘  │
│                                      │
│  ☑ I agree to sign electronically    │
│                                      │
│  Full Name: [________________]       │
│                                      │
│  ┌─ Draw │ Type ──────────────────┐  │
│  │  [Signature canvas / typed]    │  │
│  │                    [Clear]     │  │
│  └────────────────────────────────┘  │
│                                      │
│  Signed at: March 5, 2026 3:45 PM   │
└──────────────────────────────────────┘
```

### Behavior

1. Waiver text is rendered from `event.waiverContent` (HTML) in a scrollable div.
2. **"I agree to sign electronically"** checkbox — required before signature pad activates. Satisfies ESIGN Act consent requirement.
3. **Full name** text input — always required regardless of draw/type choice.
4. **Tab toggle** — "Draw" and "Type" tabs:
   - **Draw**: `signature_pad` canvas. User draws with mouse/finger. "Clear" button resets.
   - **Type**: Full name auto-rendered in a cursive Google Font (e.g., *Dancing Script* or *Great Vibes*). User sees a live preview of their typed name as a signature.
5. Signature is **required** — form cannot submit without a valid signature.
6. On submit, `userAgent` is captured from `navigator.userAgent`, and `ipAddress` is fetched from the `captureSignerIp` Cloud Function.

### Validation

The existing `validate()` function in `EventRegistrationForm` gains new checks:
- `consentToESign` must be `true`
- `signerName` must be non-empty
- Either `signatureData` (draw) or `signatureFont` (typed) must be present

---

## 5. Audit Trail — captureSignerIp Cloud Function

A simple HTTPS Callable Cloud Function:

```js
exports.captureSignerIp = onCall((request) => {
  return { ip: request.rawRequest.ip || request.rawRequest.headers['x-forwarded-for'] };
});
```

- Called once during registration submit, before writing to Firestore.
- Returns the client's IP address (browsers cannot reliably self-report this).
- No authentication required (registrants are anonymous users).

---

## 6. Admin Viewing — SignatureViewer

In `RegistrationViewer.jsx`, when viewing a registration that has `signatureRecord.signed === true`:

- **Inline display**: Show signature image (draw) or typed name in cursive font, signer name, date, and a "Signed ✓" badge.
- **"Download Signed Waiver" button**: Generates a PDF client-side using `pdf-lib` containing:
  - Waiver title
  - Waiver content (rendered as text — `pdf-lib` doesn't render HTML, so we'll convert to plain text with basic formatting)
  - Signature image or typed name
  - Signer name, email, date
  - Audit trail metadata (IP, user agent, content hash)
  - "Electronically signed via [App Name]" footer

### pdf-lib Choice Rationale

- MIT licensed, zero dependencies, no known vulnerabilities
- Works client-side (no Cloud Function needed)
- Can embed PNG images (for drawn signatures)
- Actively maintained

---

## 7. Dependencies

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| `signature_pad` | ^5.x | MIT | Draw-on-canvas signature capture |
| `@tiptap/react` | ^2.x | MIT | Rich text editor (React bindings) |
| `@tiptap/starter-kit` | ^2.x | MIT | TipTap core extensions bundle |
| `@tiptap/extension-underline` | ^2.x | MIT | Underline formatting |
| `pdf-lib` | ^1.x | MIT | Client-side PDF generation |

All dependencies are MIT licensed ✓

---

## 8. Firestore Security Rules

Existing rules need updates:

- **Registrations**: Allow `signatureRecord` field to be written on creation (anonymous users can submit).
- **Events**: Only authenticated org members can read/write `waiverContent` and related fields (already covered by existing org-member rules).

No new collections are introduced.

---

## 9. What This Design Does NOT Include (Intentional)

- ❌ PDF upload for waivers (can be added in v2)
- ❌ Multiple waivers per event (data model supports it later)
- ❌ Email copy of signed waiver to registrant (can be added in v2)
- ❌ Waiver templates (org-level reusable waivers — future feature)
- ❌ Legal disclaimer text (org is responsible for their own waiver language)
