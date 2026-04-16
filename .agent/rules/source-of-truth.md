# Event Registration System

## Project Overview
A universal, multi-event registration system with admin-configurable form fields, optional payments, capacity/waitlist management, and organizer notifications. While developed for the UMC Kent community to replace disjointed tools, its architecture is a generalized model suitable for any organization requiring embeddable, data-driven registration.

## Tech Stack
- **Frontend:** React 19, Tailwind CSS v4, Vite
- **Backend/Platform:** Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **Hosting:** Firebase Hosting Classic (CDN-only, project `event-registration-b7840`)
- **Deployment Strategy:** Configured for standalone Web Widgets (embeddable via script tags, e.g., in WordPress) alongside a hosted dashboard platform.

## Architectural Design & Differentiators

### 1. JSON Schema Driven Dynamic Forms
To avoid building custom forms for every specific event, the system uses a JSON schema-based renderer:
- **Admin Capability:** Visual drag-and-drop form builder. Utilizes "Template Groups" to instantly drop in common field sets (Name, Address, Contact Info).
- **Data Model:** Form fields are stored in the `events` table as a `form_fields` JSONB column — an array of field objects (id, type, label, required, options).
- **Public Render:** A `DynamicField` UI maps schema types (text, email, phone, number, checkboxGroup, date) to appropriate React primitives.

### 2. PostgreSQL Multi-Tenancy with Row Level Security
To support multiple administrators and committees (e.g., VBS, Men's Ministry, Outreach) without data leakage:
- **Data Model:** Relational tables: `organizations`, `org_members`, `events`, `registrations`. All scoped by `org_id` foreign keys.
- **Access Control:** An `org_members` junction table maps users to organizations with roles (owner, admin, member). RLS policies verify membership before authenticating access.
- **Org Selection:** Admin dashboard incorporates an `OrgPicker` component for seamlessly toggling between active contexts if a user spans multiple organizations.

### 3. Capacity & Atomic Waitlist Promotion
Data integrity at scale is maintained automatically using PostgreSQL triggers:
- **Atomicity:** `handle_new_registration` trigger runs AFTER INSERT on registrations, atomically incrementing capacities and sorting users into `confirmed` or `waitlisted`.
- **Auto-Promotion:** `handle_registration_cancellation` trigger fires AFTER UPDATE. When a confirmed registrant cancels, the oldest waitlisted registration is automatically promoted to `confirmed`.
- **Scheduled Digests:** A `weekly-digest` Edge Function aggregates performance/payment statistics and emails designated event organizers on a configurable schedule.

### 4. Self-Service Operations
- **Cancellation via HMAC Tokens:** Each confirmation email generates a uniquely signed HMAC-SHA256 token valid for 90 days. This securely allows a registrant to cancel their booking asynchronously without authentication. Cancellation is performed via the `cancel_registration` RPC (SECURITY DEFINER function).
- **Single Embed Pattern:** Enables utilizing `data-event-id="abc123"` directly on embed wrapper elements, skipping internal programmatic landing page routing and projecting the specific event natively.

### 5. Multi-Channel Payments
Implements a deferred/capture-to-submission architecture for dynamic paths: fully online checkouts via PayPal/Venmo integrations versus administratively-verified offline/in-person mechanisms (e.g. "Pay by Cash"). Payment status updates are handled via the `update_payment_status` RPC (SECURITY DEFINER function).

### 6. Browser-Native Admin Reporting
Features a custom-engineered print scope where `@media print` directives sanitize web elements and inject high-contrast, paper-optimized typography, rendering perfectly spaced "Sign-In Sheets" and "Individual Forms" for onsite volunteer utilization.

### 7. Supabase Edge Functions
Server-side logic implemented as Deno-based Edge Functions:
- `capture-signer-ip` — Returns client IP for e-sign audit trail (no auth)
- `resolve-member-email` — Resolves email to Auth user and adds to org_members (JWT required)
- `send-registration-email` — Database webhook handler for confirmation, cancellation, promotion, and organizer notification emails via SMTP
- `weekly-digest` — Scheduled digest emails to event organizers
