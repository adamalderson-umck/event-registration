import { describe, expect, it } from 'vitest';
import {
    PARKING_CONFIRMATION_MESSAGE_STARTER,
    REMINDER_MESSAGE_STARTER,
    applyReminderHoursChange,
    hasReminderSchedule,
    validateEventEmailDraft,
    validateEventEmailRecord,
} from '../eventEmailMessages';

describe('event email message configuration', () => {
    it('requires parking confirmation text only for active parking events', () => {
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'parking', confirmationMessage: '   ',
        })).toEqual(['Active parking events require a confirmation email message.']);
        expect(validateEventEmailDraft({
            status: 'draft', eventType: 'parking', confirmationMessage: '',
        })).toEqual([]);
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'standard', confirmationMessage: '',
        })).toEqual([]);
    });

    it('requires reminder text only for active reminder-enabled events', () => {
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'standard', reminderHoursBefore: '24', reminderMessage: '',
        })).toEqual(['Active events with a reminder time require a reminder email message.']);
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'standard', reminderHoursBefore: '', reminderMessage: '',
        })).toEqual([]);
    });

    it('maps persisted records to the same validation contract', () => {
        expect(validateEventEmailRecord({
            status: 'active',
            event_type: 'parking',
            confirmation_message: PARKING_CONFIRMATION_MESSAGE_STARTER,
            reminder_hours_before: 24,
            reminder_message: REMINDER_MESSAGE_STARTER,
        })).toEqual([]);
    });

    it('seeds a blank reminder only when a schedule is enabled and preserves authored text', () => {
        expect(hasReminderSchedule('24')).toBe(true);
        expect(hasReminderSchedule('')).toBe(false);
        expect(applyReminderHoursChange({ reminderMessage: '' }, '24')).toEqual({
            reminderHoursBefore: '24',
            reminderMessage: REMINDER_MESSAGE_STARTER,
        });
        expect(applyReminderHoursChange({ reminderMessage: 'Pickup at the office.' }, '')).toEqual({
            reminderHoursBefore: '',
            reminderMessage: 'Pickup at the office.',
        });
    });
});
