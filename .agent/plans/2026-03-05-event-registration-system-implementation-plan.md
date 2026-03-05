# Event Registration System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an embeddable, multi-event registration system with admin-configurable form fields, optional PayPal payments, capacity/waitlist management, self-cancellation, print reports, and confirmation emails.

**Architecture:** Vite + React SPA with Firebase backend (Firestore, Cloud Functions, Hosting). Multi-organization data model with subcollections. Public form dynamically renders from JSON schema stored in Firestore. Admin dashboard provides event CRUD, visual form builder, registration management, and configurable organizer notifications.

**Tech Stack:** Vite, React 19, TailwindCSS v4, Firebase (Firestore, Cloud Functions v2, Hosting), @dnd-kit, lucide-react, @paypal/react-paypal-js, nodemailer, vitest

**Design Doc:** [design_doc.md](file:///C:/Users/kentu/.gemini/antigravity/brain/f5a32fba-f141-40b4-8442-ff2093688a04/design_doc.md)

---

## Task 1: Project Scaffolding & Firebase Setup

Scaffold Vite + React, install all deps, configure TailwindCSS v4, widget-friendly build output, Firebase project init, Firestore rules with org-based access, `services/firebase.js`.

Firestore rules use `isOrgMember(orgId)` and `isOrgOwner(orgId)` helpers — public can read events and create registrations, org members manage events/registrations, only org owner can update/delete the org doc.

| Action | File |
|--------|------|
| Create | `package.json`, `vite.config.js`, `index.html`, `.gitignore` |
| Create | `.firebaserc`, `firebase.json`, `firestore.rules`, `firestore.indexes.json` |
| Create | `src/main.jsx`, `src/index.css`, `src/App.css`, `src/services/firebase.js`, `src/test/setup.js` |

---

## Task 2: Organization Setup & Admin Org Management

Organizations collection as top-level tenant. Events and registrations are subcollections under orgs.

**Org creation:** Any authenticated admin clicks "Create Organization" → fills name + optional SMTP config → creator becomes `ownerUid` and is auto-added to `members`.

**Member management (owner-only):** Owner adds members by Google email → Cloud Function resolves email to UID (or stores as pending invite). Owner can remove members.

**Admin login flow:** Google sign-in → query orgs where user's UID is in `members` → org picker if multiple, auto-select if single. If no orgs, show "Create Organization" prompt.

| Action | File |
|--------|------|
| Create | `src/components/CreateOrg.jsx` |
| Create | `src/components/OrgPicker.jsx` |
| Create | `src/components/OrgSettings.jsx` |
| Create | `src/components/MemberManager.jsx` |
| Create | `src/context/OrgContext.jsx`, `src/context/useOrg.js` |

`OrgContext` provides `currentOrg` to all admin components. All Firestore reads/writes in admin scoped to `organizations/{orgId}/...`.

---

## Task 3: Shared UI Primitives & Context

Button (primary/secondary/danger/ghost), Card, Input, Label, Checkbox, Select. AppModeContext detecting `data-mode` and `data-event-id`.

| Action | File |
|--------|------|
| Create | `src/components/ui/Button.jsx`, `Card.jsx`, `Input.jsx`, `Label.jsx`, `Checkbox.jsx`, `Select.jsx` |
| Create | `src/context/AppModeContext.jsx`, `src/context/useAppMode.js` |

---

## Task 4: Dynamic Form Renderer (Public)

`DynamicField` switch component rendering all 10 field types. `EventRegistrationForm` fetching event schema from Firestore and rendering dynamic fields with validation. `SuccessState` and `WaitlistNotice`.

| Action | File |
|--------|------|
| Create | `src/components/DynamicField.jsx`, `EventRegistrationForm.jsx`, `SuccessState.jsx`, `WaitlistNotice.jsx` |
| Test | `src/components/__tests__/DynamicField.test.jsx` |

---

## Task 5: Event Landing Page (Public)

`EventLanding` with real-time listener on active events. `EventCard` showing title, dates, spots remaining. Grid layout with empty state. Public URLs include orgId: `/?org=umc-kent` or `/?org=umc-kent&event=abc`.

| Action | File |
|--------|------|
| Create | `src/components/EventLanding.jsx`, `src/components/EventCard.jsx` |

---

## Task 6: App Shell & Routing

`App.jsx` with URL-based routing via query params. Standalone/embed header/footer. PayPalScriptProvider wrapper.

| URL | View |
|-----|------|
| `/?org=slug` | Event landing page for org |
| `/?org=slug&event=abc` | Event registration form |
| `/cancel?token=xxx` | Self-service cancellation |
| `/?admin=true` | Admin login → org picker → dashboard |

---

## Task 7: Admin Login & Dashboard Overview

Google sign-in popup. After login, query orgs for membership → `OrgPicker` if multiple. Dashboard with metric cards and event list scoped to current org. "Create New Event" button.

| Action | File |
|--------|------|
| Create | `src/components/AdminLogin.jsx`, `src/components/AdminDashboard.jsx` |

---

## Task 8: Event Editor & Form Field Builder (Admin)

`EventEditor` with event details + capacity + payment config + organizer notification settings (organizer email list, per-registration toggle, weekly digest toggle). `FormFieldBuilder` with @dnd-kit drag-and-drop. `FieldConfigPanel` for per-field config. Template field groups.

| Action | File |
|--------|------|
| Create | `src/components/EventEditor.jsx`, `FormFieldBuilder.jsx`, `FieldConfigPanel.jsx` |
| Create | `src/config/fieldTemplates.js` (US states list + template groups) |

---

## Task 9: Registration Viewer & Print Reports (Admin)

Dynamic table with columns from event's formFields. Search/filter, status filter. Detail modal. Print functions: Individual Registration, Registration Table, Sign-In Sheet, Event Summary — all via `window.open()` + `document.write()`.

| Action | File |
|--------|------|
| Create | `src/components/RegistrationViewer.jsx`, `RegistrationDetailModal.jsx` |
| Create | `src/utils/printReports.js` |

---

## Task 10: PayPal Payment Integration

`PaymentSection` with PayPal buttons + Pay In Person option. Wired into `EventRegistrationForm` — only shown when event has `paymentEnabled: true`.

| Action | File |
|--------|------|
| Create | `src/components/PaymentSection.jsx` |
| Modify | `src/components/EventRegistrationForm.jsx` |

---

## Task 11: Cloud Functions (Registration Processing, Email & Notifications)

Org-scoped Firestore triggers. `onRegistrationCreated` handles counts, confirmation email + organizer notification. `onRegistrationUpdated` handles cancellation + waitlist promotion. Cancel token callables. `weeklyDigest` scheduled function. `resolveMemberEmail` callable resolves Google email to Firebase UID for member invitation.

| Action | File |
|--------|------|
| Create | `functions/package.json`, `functions/index.js` |
| Create | `functions/cancelRegistration.js`, `functions/emailTemplates.js` |
| Create | `functions/weeklyDigest.js` |
| Create | `functions/resolveMemberEmail.js` |

---

## Task 12: Cancel Registration Page

`CancelRegistration` component: verify token via callable, show registration summary, confirm cancellation, success/error states.

| Action | File |
|--------|------|
| Create | `src/components/CancelRegistration.jsx` |

---

## Task 13: Embed Docs & Final Polish

`EMBED.md` with single-event and landing-page embed code. `README.md`. Print stylesheet. Final build verification.

| Action | File |
|--------|------|
| Create | `EMBED.md`, `README.md` |
| Modify | `src/index.css` (print styles) |

---

## Verification Plan

### Automated Tests

```bash
npx vitest run
```

- `DynamicField.test.jsx` — each of 10 field types renders and handles onChange
- `Button.test.jsx` — variants, click handler, loading state

### Manual Browser Verification

| # | Test | Steps |
|---|------|-------|
| 1 | Dev server starts | Run `npm run dev`, open `http://localhost:5173`, verify landing page loads |
| 2 | Admin creates org + event | Sign in, create org (name + SMTP), add a member by email, create event with form fields, template groups, organizer notification config |
| 3 | Public form renders | Go to `/?org=slug&event={id}`, verify all fields render |
| 4 | Form submission | Fill required fields, submit, verify SuccessState + organizer notification email |
| 5 | Capacity/waitlist | Set capacity to 1, register twice, verify waitlist |
| 6 | Payment flow | Enable payment, verify PayPal buttons, test Pay In Person |
| 7 | Admin views registrations | Verify table columns, search, status filters |
| 8 | Print reports | Test all 4 print reports |
| 9 | Cancel flow | Open cancel link, confirm cancel, verify emails + waitlist promotion |
| 10 | Embed mode | Test `data-mode="embed" data-event-id` + `data-org-id` |
| 11 | Multi-org | Sign in with user who is member of 2 orgs, verify org picker |
| 12 | Weekly digest | Trigger digest function manually, verify email content |
| 13 | Build output | `npm run build`, verify widget files exist |
