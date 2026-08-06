# Event Registration System

A dynamic, multi-tenant Event Registration System with secure forms, waiver signatures, waitlists, and Tithe.ly payment hand-offs. Built with React 19, Tailwind CSS v4, and Supabase.

## Features

- **Multi-Tenant Organizations:** Hosts multiple organizations; each can have completely isolated events and forms.
- **Dynamic Form Engine:** Fully customizable fields (Text, Email, Phone, Checkbox, Radio, Textarea) with conditional logic rendering.
- **Electronic Waivers:** E-signature capture (draw or type) with legally compliant IP and timestamp logging.
- **Atomic Waitlist Management:** Database-level capacities with Supabase Edge Functions handling promotions automatically upon cancellations.
- **Security & Bot Protection:** Cloudflare Turnstile CAPTCHA and Sentry Error Monitoring built-in.
- **Payments:** Optional Tithe.ly form hand-off with administrator-verified payment status for paid events.

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4
- **Backend:** Supabase (Auth, Postgres, Edge Functions, Storage)
- **UI Components:** Lucide React, dnd-kit (drag and drop builder), Signature Pad
- **Testing:** Vitest & React Testing Library

## Quick Start

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Copy the `.env.example` file to `.env.local` and add your required Supabase keys:
   ```bash
   cp .env.example .env.local
   # Edit .env.local to set your Supabase URL and Anon Key
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

## Supabase Development

Docker or another Docker-compatible runtime is required for the local Supabase stack. Install dependencies, start the disposable local services, rebuild the database from the migration ledger without seed data, and inspect local history with:

```powershell
npm install
npx supabase start
npx supabase db reset --local --no-seed
npx supabase migration list --local
```

Create every migration through the pinned project CLI, then run the repository safety check:

```powershell
npx supabase migration new add_registration_deadline
npm run check:migrations
```

Never hand-author a migration timestamp. The first 35 applied versions are timestamp markers because their original SQL is not an authoritative replay source. Migration `20260806001553` is the reviewed schema baseline that recreates the current application database; later files are ordinary forward migrations. Do not add executable SQL to a marker or replace the baseline with a marker.

The `supabase/.temp` directory is uncommitted local CLI state. `db reset --local` deletes and recreates only the disposable local database.

The baseline stores inert local Vault placeholders named `project_url` and `anon_key`. To test webhooks locally, use local Studio to replace those values with the API URL and anon key printed by `npx supabase status`. Never commit either value.

### Linked migration gate

Authenticate, link explicitly to the Event Registration project, compare histories, and preview the remote operation:

```powershell
npx supabase login
npx supabase link --project-ref eonpdgufuewpqdjpshbc
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

The expected current state is 36 aligned applied migrations and one local-only Tithe.ly migration. If the histories differ in any other way, stop: do not run `db push`, `migration repair`, or `db reset --linked`. Any production write requires separate explicit authorization.

## Production Deployment

This project uses **Firebase Classic Hosting** for the frontend, configured to work seamlessly with React SPA routing.

- Automated deployments are set up via **GitHub Actions** (`.github/workflows/ci.yml`).
- Commits to the `main` branch are automatically linted, tested, built, and pushed to Firebase.
- Required environment variables (Sentry, Supabase, Turnstile) should be added to your GitHub Repository Secrets.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
