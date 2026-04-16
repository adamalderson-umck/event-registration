# Event Registration System — Roadmap

## ✅ Shipped (v1.1 Quick Wins — March 2026)

- CSV/Excel export for registrations
- Shareable link + QR code
- Duplicate/clone event
- Add to Calendar (Google Calendar + .ics)
- Registration close date (auto-close)
- Pre-event reminder emails (pg_cron)

## ✅ Shipped (v1.2 — March 2026)

- **Forms V2** — conditional field logic (show/hide) + multi-page forms with stepper
- **Header image upload** — per-event drag-and-drop hero banner (Supabase Storage, 5MB, 16:9 soft constraint)
- **Theme color choice** — 8 curated presets + custom hex, applied to public form header/buttons/accents
- **WYSIWYG live preview** — real-time preview pane in form builder showing exact public form rendering
- **Org-level branding defaults** — DB columns in place ([org settings UI deferred](#-backlog--medium-effort))

---

## 🔨 In Design — Forms V2 (Advanced)

> [Design doc](./2026-03-24-forms-v2-design.md)

- **Future:** multi-condition rules (AND/OR), additional operators (contains, isEmpty, greaterThan)

---

## 📋 Backlog — Medium Effort

| Feature | Est. Effort | Source |
|---------|-------------|--------|
| Flexible canvas / per-field width control | ~3 hr | WYSIWYG preview companion |
| Org settings UI (default header image + theme) | ~2 hr | Header/theme design |
| Admin CSV import of registrants | ~2 hr | Gap analysis #7 |
| File/image upload field type (Supabase Storage) | ~3–4 hr | Gap analysis #8 |

---

## 📋 Backlog — Significant Effort

| Feature | Notes |
|---------|-------|
| Stripe/Square payments | Merchant preference only — PayPal SDK covers inline card payments |
| Group/family registration | Schema redesign for linked registrations |
| Attendance check-in (QR scan) | Mobile-optimized admin UI + QR scanning |
| Zapier / API access | Public REST API, auth tokens, documentation |
| SMS/WhatsApp notifications | Twilio or similar integration |
