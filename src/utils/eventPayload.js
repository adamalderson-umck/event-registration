import { validateParkingEventDraft } from '../config/eventPresets';
import { sha256 } from './hashContent';
import { normalizeTithelyConfiguration } from './tithelyEmbed';

export async function buildEventPayload(event, orgId) {
    if (event.status === 'active') {
        const validationError = validateParkingEventDraft(event)[0];
        if (validationError) throw new Error(validationError);
    }

    let tithelyConfiguration = { givingUrl: null, embedConfig: null };
    let tithelyConfigurationError = null;

    try {
        tithelyConfiguration = normalizeTithelyConfiguration({
            givingUrl: event.tithelyGivingUrl,
            embedCode: event.tithelyEmbedCode,
            existingEmbedConfig: event.tithelyEmbedConfig,
        });
    } catch (error) {
        tithelyConfigurationError = error;
    }

    if (event.status === 'active' && event.paymentEnabled
        && !tithelyConfiguration.givingUrl && !event.allowInPersonPayment) {
        const paymentError = new Error('Payment-enabled events require a valid Tithe.ly form or Pay in Person.');
        if (tithelyConfigurationError) paymentError.cause = tithelyConfigurationError;
        throw paymentError;
    }

    return {
        title: event.title.trim(),
        slug: event.slug.trim() || null,
        description: event.description.trim(),
        location: event.location.trim(),
        start_date: event.startDate || null,
        end_date: event.endDate || null,
        registration_close_date: event.registrationCloseDate || null,
        status: event.status,
        event_type: event.eventType,
        capacity: event.capacity ? parseInt(event.capacity, 10) : null,
        waitlist_enabled: event.waitlistEnabled,
        payment_enabled: event.paymentEnabled,
        payment_amount: event.paymentAmount ? parseFloat(event.paymentAmount) : null,
        allow_in_person_payment: event.allowInPersonPayment,
        tithely_giving_url: tithelyConfiguration.givingUrl
            || (typeof event.tithelyGivingUrl === 'string' && event.tithelyGivingUrl.trim())
            || null,
        tithely_embed_config: tithelyConfiguration.embedConfig,
        form_fields: event.formFields,
        notifications: {
            organizers: event.notifications.organizers.filter((email) => email.trim() !== ''),
            perRegistration: event.notifications.perRegistration,
            weeklyDigest: event.notifications.weeklyDigest,
            digestDay: event.notifications.digestDay,
        },
        reminder_hours_before: event.reminderHoursBefore ? parseInt(event.reminderHoursBefore, 10) : null,
        waivers: await Promise.all(
            event.waivers.map(async (waiver, index) => ({
                ...waiver,
                title: waiver.title.trim(),
                contentHash: await sha256(waiver.content || ''),
                order: index,
            }))
        ),
        header_image_url: event.headerImageUrl,
        theme: event.theme,
        org_id: orgId,
    };
}

export function buildDuplicateEventPayload(sourceEvent) {
    const {
        id: _id,
        created_at: _createdAt,
        updated_at: _updatedAt,
        registration_count: _registrationCount,
        waitlist_count: _waitlistCount,
        reminder_sent_at: _reminderSentAt,
        slug: _slug,
        ...configuration
    } = sourceEvent;

    return {
        ...configuration,
        title: `${sourceEvent.title} (Copy)`,
        slug: null,
        status: 'draft',
        registration_count: 0,
        waitlist_count: 0,
        reminder_sent_at: null,
    };
}
