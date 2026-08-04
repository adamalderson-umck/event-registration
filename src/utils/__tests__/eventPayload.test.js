import { describe, expect, it } from 'vitest';
import { createEventPreset } from '../../config/eventPresets';
import { buildDuplicateEventPayload, buildEventPayload } from '../eventPayload';

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
        eventType: 'parking',
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
            org_id: 'org-1',
        });
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

    it('builds a draft duplicate without registration state while preserving parking configuration', () => {
        const source = {
            ...createParkingDraft(),
            event_type: 'parking',
            allow_in_person_payment: true,
            id: 'event-1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            registration_count: 10,
            waitlist_count: 2,
            reminder_sent_at: '2026-08-01T00:00:00Z',
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
        });
        expect(payload).not.toHaveProperty('id');
    });
});
