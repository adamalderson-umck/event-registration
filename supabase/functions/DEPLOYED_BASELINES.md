# Deployed Edge Function Baselines

Read from Supabase project `eonpdgufuewpqdjpshbc` on 2026-08-06 with Supabase CLI 2.111.0.

| Function | Version | Verify JWT | Entrypoint | Bundle SHA-256 |
|---|---:|:---:|---|---|
| capture-signer-ip | 4 | false | `index.ts` | `7204504bd31ed1bcec5688a3d787705804dd783ae9d273ab150455d799da0e01` |
| resolve-member-email | 4 | true | `resolve-member-email/index.ts` | `7bfa7ce181214a5315cb98d9b5638d6c2e4ab2f2c088a757a4d651b2c5db5b25` |
| send-event-reminders | 2 | false | `index.ts` | `f30b5437e47f375a2933e59de9c0fc922e4d2a22126781af37547ef49727ac0e` |
| send-organizer-invite | 4 | true | `send-organizer-invite/index.ts` | `dd8d3785d1d64f87402cf32546d2e27625562678a1e49d6a2321cfa2d62ed576` |
| send-registration-email | 7 | false | `send-registration-email.ts` | `ade3a9d9e03ac124dd386cf1d44b599d6f7ad15fe48668ca030a2657d954b397` |
| submit-registration | 1 | false | `supabase/functions/submit-registration/index.ts` | `1091232fc9ce5a44c37f2a77005a0e05d362488f364e197eb79de778da8ccfce` |
| update-registration-answers | 2 | true | `supabase/functions/update-registration-answers/index.ts` | `7ec13dd0132d9211aac6ddcdb639c5c9868318ad58fb31b9170959d800f337c3` |
| verify-cancel-token | 3 | false | `index.ts` | `2ceefd0a228bbc5179fd97267af88149058b3a0e9af6950e1365458c8a1ffa40` |
| weekly-digest | 2 | false | `index.ts` | `e439e792d708bb5bdf6910a8a7b363716773731016496f39bd55a8852ba25cd9` |

`update-registration-answers` was read back from the live project on 2026-08-11 after its version 2 CORS deployment.

The bundle hash is Supabase deployment metadata, not a hash of an individual downloaded source file. The five missing functions were committed immediately after download. `capture-signer-ip`, `verify-cancel-token`, and `weekly-digest` are recovery-only in the email-message-control project and must not be behaviorally changed or redeployed there.
