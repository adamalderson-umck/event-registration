import { describe, expect, it } from 'vitest';
import { createEventPreset } from '../../config/eventPresets';
import { buildDuplicateEventPayload, buildEventPayload } from '../eventPayload';

const TITHELY_FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const TITHELY_LOCATION_ID = 'c9f19096-4a76-4ea1-be56-d7f16d1e5241';
const TITHELY_FUND_ID = 'c4c11990-779e-4582-ba46-bf510ed3a37f';
const TITHELY_GIVING_URL = `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}&locationId=${TITHELY_LOCATION_ID}&fundId=${TITHELY_FUND_ID}&amount=10000&frequency=one-time`;
const TITHELY_EMBED_CODE = `<button class="tithely-give-button" data-form="${TITHELY_FORM_ID}" data-location="${TITHELY_LOCATION_ID}" data-fund="${TITHELY_FUND_ID}" data-amount="10000" data-frequency="one-time" style="background: #fff">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`;
const TITHELY_EMBED_CONFIG = {
    formId: TITHELY_FORM_ID,
    locationId: TITHELY_LOCATION_ID,
    fundId: TITHELY_FUND_ID,
    amount: '10000',
    frequency: 'one-time',
};

const createParkingDraft = () => {
    const preset = createEventPreset('parking');

    return {
        title: 'Fall 2026 Parking',
        slug: 'fall-2026-parking',
        description: 'Parking permits for the fall semester.',
        location: 'Church parking lot',
        startDate: '2026-08-15T09:00',
        endDate: '2026-12-15T17:00',
        registrationCloseDate: '2026-12-01T23:59',
        status: 'active',
        capacity: '50',
        waitlistEnabled: true,
        paymentEnabled: true,
        paymentAmount: '100',
        allowInPersonPayment: true,
        tithelyGivingUrl: TITHELY_GIVING_URL,
        tithelyEmbedCode: TITHELY_EMBED_CODE,
        tithelyEmbedConfig: null,
        eventType: 'parking',
        confirmationMessage: preset.confirmationMessage,
        reminderMessage: '',
        formFields: preset.formFields,
        waivers: preset.waivers,
        notifications: {
            organizers: ['admin@example.org', ''],
            perRegistration: true,
            weeklyDigest: true,
            digestDay: 'monday',
        },
        reminderHoursBefore: '',
        headerImageUrl: null,
        theme: null,
    };
};

describe('event payloads', () => {
    it('builds a valid parking event payload and preserves protected configuration', async () => {
        const event = createParkingDraft();

        const payload = await buildEventPayload(event, 'org-1');

        expect(payload).toMatchObject({
            event_type: 'parking',
            allow_in_person_payment: true,
            payment_enabled: true,
            payment_amount: 100,
            tithely_giving_url: TITHELY_GIVING_URL,
            tithely_embed_config: TITHELY_EMBED_CONFIG,
            confirmation_message: 'Thank you for registering for this parking event.',
            reminder_message: null,
            org_id: 'org-1',
        });
        expect(payload).not.toHaveProperty('tithely_embed_code');
        expect(payload.form_fields).toContainEqual(expect.objectContaining({ id: 'parking_license_plate' }));
        expect(payload.waivers).toContainEqual(expect.objectContaining({
            id: 'parking_rules_agreement',
            contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        }));
    });

    it('rejects an active parking event without a positive payment amount', async () => {
        const event = { ...createParkingDraft(), paymentAmount: '' };

        await expect(buildEventPayload(event, 'org-1')).rejects.toThrow(
            'Parking events require payment with a positive amount.'
        );
    });

    it('rejects active events with missing required email messages', async () => {
        await expect(buildEventPayload({
            ...createParkingDraft(),
            confirmationMessage: '   ',
        }, 'org-1')).rejects.toThrow(
            'Active parking events require a confirmation email message.'
        );

        await expect(buildEventPayload({
            ...createParkingDraft(),
            eventType: 'standard',
            confirmationMessage: '',
            reminderHoursBefore: '24',
            reminderMessage: '',
        }, 'org-1')).rejects.toThrow(
            'Active events with a reminder time require a reminder email message.'
        );
    });

    it('allows an active payment-enabled event to use only Pay in Person', async () => {
        const event = {
            ...createParkingDraft(),
            eventType: 'standard',
            tithelyGivingUrl: '',
            tithelyEmbedCode: '',
            tithelyEmbedConfig: null,
        };

        const payload = await buildEventPayload(event, 'org-1');

        expect(payload).toMatchObject({
            allow_in_person_payment: true,
            tithely_giving_url: null,
            tithely_embed_config: null,
        });
    });

    it('rejects invalid Tithe.ly configuration even when Pay in Person remains available', async () => {
        const event = {
            ...createParkingDraft(),
            eventType: 'standard',
            tithelyGivingUrl: '  https://example.org/give  ',
            tithelyEmbedCode: '',
            tithelyEmbedConfig: null,
        };

        await expect(buildEventPayload(event, 'org-1')).rejects.toThrow(
            'Use an HTTPS give.tithe.ly giving URL.',
        );
    });

    it('rejects a giving URL without an embed even when Pay in Person remains available', async () => {
        const event = {
            ...createParkingDraft(),
            eventType: 'standard',
            tithelyEmbedCode: '',
            tithelyEmbedConfig: null,
        };

        await expect(buildEventPayload(event, 'org-1')).rejects.toThrow(
            'Paste the official Tithe.ly embed code.',
        );
    });

    it('requires a valid payment path for active payment-enabled events', async () => {
        const event = {
            ...createParkingDraft(),
            eventType: 'standard',
            allowInPersonPayment: false,
            tithelyGivingUrl: '',
            tithelyEmbedCode: '',
            tithelyEmbedConfig: null,
        };

        await expect(buildEventPayload(event, 'org-1')).rejects.toThrow(
            'Payment-enabled events require a valid Tithe.ly form or Pay in Person.'
        );
    });

    it('reuses a saved Tithe.ly form configuration when the embed code is blank', async () => {
        const event = {
            ...createParkingDraft(),
            tithelyEmbedCode: '',
            tithelyEmbedConfig: { formId: TITHELY_FORM_ID },
        };

        const payload = await buildEventPayload(event, 'org-1');

        expect(payload).toMatchObject({
            tithely_giving_url: TITHELY_GIVING_URL,
            tithely_embed_config: TITHELY_EMBED_CONFIG,
        });
    });

    it('builds a draft duplicate without registration state while preserving parking configuration', () => {
        const source = {
            ...createParkingDraft(),
            event_type: 'parking',
            allow_in_person_payment: true,
            tithely_giving_url: TITHELY_GIVING_URL,
            tithely_embed_config: TITHELY_EMBED_CONFIG,
            id: 'event-1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            registration_count: 10,
            waitlist_count: 2,
            reminder_sent_at: '2026-08-01T00:00:00Z',
            confirmation_message: 'Pickup at the church office.',
            reminder_message: 'Bring photo identification.',
        };

        const payload = buildDuplicateEventPayload(source);

        expect(payload).toMatchObject({
            title: 'Fall 2026 Parking (Copy)',
            slug: null,
            status: 'draft',
            registration_count: 0,
            waitlist_count: 0,
            reminder_sent_at: null,
            event_type: 'parking',
            allow_in_person_payment: true,
            tithely_giving_url: TITHELY_GIVING_URL,
            tithely_embed_config: TITHELY_EMBED_CONFIG,
            confirmation_message: 'Pickup at the church office.',
            reminder_message: 'Bring photo identification.',
        });
        expect(payload).not.toHaveProperty('id');
    });
});
