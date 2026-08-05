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

## Production Deployment

This project uses **Firebase Classic Hosting** for the frontend, configured to work seamlessly with React SPA routing.

- Automated deployments are set up via **GitHub Actions** (`.github/workflows/ci.yml`).
- Commits to the `main` branch are automatically linted, tested, built, and pushed to Firebase.
- Required environment variables (Sentry, Supabase, Turnstile) should be added to your GitHub Repository Secrets.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
