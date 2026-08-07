export const PARKING_CONFIRMATION_MESSAGE_STARTER =
    'Thank you for registering for this parking event.';

export const REMINDER_MESSAGE_STARTER =
    'This is a friendly reminder that your event is coming up soon!';

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

export const hasReminderSchedule = (value) => (
    value !== null && value !== undefined && String(value).trim() !== ''
);

export function validateEventEmailDraft(event) {
    if (event?.status !== 'active') return [];

    const errors = [];
    if (event.eventType === 'parking' && !hasText(event.confirmationMessage)) {
        errors.push('Active parking events require a confirmation email message.');
    }
    if (hasReminderSchedule(event.reminderHoursBefore) && !hasText(event.reminderMessage)) {
        errors.push('Active events with a reminder time require a reminder email message.');
    }
    return errors;
}

export const validateEventEmailRecord = (event) => validateEventEmailDraft({
    status: event?.status,
    eventType: event?.event_type,
    confirmationMessage: event?.confirmation_message,
    reminderHoursBefore: event?.reminder_hours_before,
    reminderMessage: event?.reminder_message,
});

export function applyReminderHoursChange(event, reminderHoursBefore) {
    return {
        reminderHoursBefore,
        reminderMessage: hasReminderSchedule(reminderHoursBefore)
            && !hasText(event?.reminderMessage)
            ? REMINDER_MESSAGE_STARTER
            : (event?.reminderMessage || ''),
    };
}
