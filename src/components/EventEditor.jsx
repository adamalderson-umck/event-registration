import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import {
    Save, ArrowLeft, CalendarDays, MapPin, Users,
    CreditCard, Bell, Loader2, ExternalLink, Paintbrush
} from 'lucide-react';
import FormFieldBuilder from './FormFieldBuilder';
import FormPreviewPane from './FormPreviewPane';
import WaiverSection from './WaiverSection';
import HeaderImageUpload from './HeaderImageUpload';
import ThemePicker from './ThemePicker';
import TithelyConfigurationFields from './TithelyConfigurationFields';
import EventEmailMessageFields from './EventEmailMessageFields';
import { buildEventPayload } from '../utils/eventPayload';
import { applyReminderHoursChange, hasReminderSchedule } from '../config/eventEmailMessages';
import { useOrg } from '../context/useOrg';
import { toSlug, isValidSlug } from '../utils/slugUtils';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import Checkbox from './ui/Checkbox';
import Card from './ui/Card';
import { EVENT_TYPES, SYSTEM_FIELDS, createEventPreset } from '../config/eventPresets';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const deduplicateFieldIds = (fields) => {
    const seen = new Set();
    let counter = 0;
    return fields.map(field => {
        if (seen.has(field.id)) {
            const newId = `field_recovered_${Date.now()}_${++counter}`;
            seen.add(newId);
            return { ...field, id: newId };
        }
        seen.add(field.id);
        return field;
    });
};

export default function EventEditor({ orgId, eventId, onBack, initialEventType = EVENT_TYPES.STANDARD }) {
    const { currentOrg } = useOrg();
    const [createdEventId, setCreatedEventId] = useState(null);
    const [loading, setLoading] = useState(!!eventId);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const originalOrganizers = useRef([]);
    const persistedEventId = eventId || createdEventId;

    const [event, setEvent] = useState(() => {
        const preset = createEventPreset(initialEventType);
        return {
        title: '',
        slug: '',
        description: '',
        location: '',
        startDate: '',
        endDate: '',
        registrationCloseDate: '',
        status: 'draft',
        capacity: '',
        waitlistEnabled: false,
        eventType: preset.eventType,
        paymentEnabled: preset.paymentEnabled,
        paymentAmount: preset.paymentAmount,
        allowInPersonPayment: preset.allowInPersonPayment,
        tithelyGivingUrl: '',
        tithelyEmbedCode: '',
        tithelyEmbedConfig: null,
        formFields: preset.formFields,
        notifications: {
            organizers: [''],
            perRegistration: false,
            weeklyDigest: false,
            digestDay: 'monday',
        },
        reminderHoursBefore: '',
        confirmationMessage: preset.confirmationMessage,
        reminderMessage: '',
        waivers: preset.waivers,
        headerImageUrl: currentOrg?.default_header_image_url || null,
        theme: null,
        };
    });

    // Load existing event
    useEffect(() => {
        if (!eventId) return;

        const fetchEvent = async () => {
            try {
                const { data, error: fetchErr } = await supabase
                    .from('events')
                    .select('*')
                    .eq('id', eventId)
                    .single();

                if (fetchErr) throw fetchErr;

                if (data) {
                    let loadedFields = deduplicateFieldIds(data.form_fields || []);
                    
                    // Inject system fields if missing
                    const missingSystemFields = SYSTEM_FIELDS.filter(
                        sf => !loadedFields.some(lf => lf.id === sf.id)
                    );
                    if (missingSystemFields.length > 0) {
                        loadedFields = [...missingSystemFields, ...loadedFields];
                    }

                    setEvent({
                        title: data.title || '',
                        slug: data.slug || '',
                        description: data.description || '',
                        location: data.location || '',
                        startDate: data.start_date ? data.start_date.slice(0, 16) : '',
                        endDate: data.end_date ? data.end_date.slice(0, 16) : '',
                        registrationCloseDate: data.registration_close_date ? data.registration_close_date.slice(0, 16) : '',
                        status: data.status || 'draft',
                        capacity: data.capacity != null ? String(data.capacity) : '',
                        waitlistEnabled: !!data.waitlist_enabled,
                        eventType: data.event_type || EVENT_TYPES.STANDARD,
                        paymentEnabled: !!data.payment_enabled,
                        paymentAmount: data.payment_amount != null ? String(data.payment_amount) : '',
                        allowInPersonPayment: !!data.allow_in_person_payment,
                        tithelyGivingUrl: data.tithely_giving_url || '',
                        tithelyEmbedCode: '',
                        tithelyEmbedConfig: data.tithely_embed_config || null,
                        formFields: loadedFields,
                        notifications: {
                            organizers: data.notifications?.organizers?.length > 0
                                ? data.notifications.organizers
                                : [''],
                            perRegistration: !!data.notifications?.perRegistration,
                            weeklyDigest: !!data.notifications?.weeklyDigest,
                            digestDay: data.notifications?.digestDay || 'monday',
                        },
                        reminderHoursBefore: data.reminder_hours_before != null ? String(data.reminder_hours_before) : '',
                        confirmationMessage: data.confirmation_message || '',
                        reminderMessage: data.reminder_message || '',
                        waivers: Array.isArray(data.waivers) ? data.waivers : [],
                        headerImageUrl: data.header_image_url || null,
                        theme: data.theme || null,
                    });
                    // Store original organizer emails for diffing on save
                    originalOrganizers.current = data.notifications?.organizers?.filter(e => e.trim() !== '') || [];
                }
            } catch (err) {
                console.error('Error loading event:', err);
                setError('Failed to load event');
            } finally {
                setLoading(false);
            }
        };

        fetchEvent();
    }, [eventId, orgId]);

    const handleChange = (key, value) => {
        setEvent((prev) => {
            const update = { ...prev, [key]: value };
            if (key === 'title' && prev.slug === '') {
                // Auto-fill slug from title only while slug is untouched
                update.slug = toSlug(value);
            }
            return update;
        });
        setSaved(false);
    };

    const handleNotificationChange = (key, value) => {
        setEvent((prev) => ({
            ...prev,
            notifications: { ...prev.notifications, [key]: value },
        }));
        setSaved(false);
    };

    const handleReminderHoursChange = (value) => {
        setEvent((previous) => ({
            ...previous,
            ...applyReminderHoursChange(previous, value),
        }));
        setSaved(false);
    };

    const handleOrganizerEmailChange = (index, value) => {
        const emails = [...event.notifications.organizers];
        emails[index] = value;
        handleNotificationChange('organizers', emails);
    };

    const addOrganizerEmail = () => {
        handleNotificationChange('organizers', [...event.notifications.organizers, '']);
    };

    const removeOrganizerEmail = (index) => {
        const emails = event.notifications.organizers.filter((_, i) => i !== index);
        handleNotificationChange('organizers', emails.length > 0 ? emails : ['']);
    };

    const handleSave = async () => {
        const submittedTithelyConfiguration = {
            givingUrl: event.tithelyGivingUrl,
            embedCode: event.tithelyEmbedCode,
            embedConfig: event.tithelyEmbedConfig,
        };

        if (!event.title.trim()) {
            setError('Event title is required');
            return;
        }

        if (event.slug.trim() && !isValidSlug(event.slug.trim())) {
            setError('Invalid slug format. Use lowercase letters, numbers, and hyphens (3–80 chars).');
            return;
        }

        setSaving(true);
        setError('');

        try {
            const eventData = await buildEventPayload(event, orgId);
            let savedEventId = persistedEventId;

            if (persistedEventId) {
                // Update existing
                const { error: updateErr } = await supabase
                    .from('events')
                    .update(eventData)
                    .eq('id', persistedEventId);

                if (updateErr) throw updateErr;
            } else {
                // Create new
                eventData.registration_count = 0;
                eventData.waitlist_count = 0;
                const { data: createdEvent, error: insertErr } = await supabase
                    .from('events')
                    .insert(eventData)
                    .select('id')
                    .single();

                if (insertErr) throw insertErr;
                if (!createdEvent?.id) throw new Error('Event was created without a returned ID');
                savedEventId = createdEvent.id;
                setCreatedEventId(createdEvent.id);
            }

            setEvent((previous) => {
                const configurationIsUnchanged = (
                    previous.tithelyGivingUrl === submittedTithelyConfiguration.givingUrl
                    && previous.tithelyEmbedCode === submittedTithelyConfiguration.embedCode
                    && previous.tithelyEmbedConfig === submittedTithelyConfiguration.embedConfig
                );

                if (!configurationIsUnchanged) return previous;

                return {
                    ...previous,
                    tithelyGivingUrl: eventData.tithely_giving_url || '',
                    tithelyEmbedCode: '',
                    tithelyEmbedConfig: eventData.tithely_embed_config || null,
                };
            });

            setSaved(true);
            setTimeout(() => setSaved(false), 3000);

            // Send organizer invite emails for newly added emails
            const newOrganizers = eventData.notifications.organizers.filter(
                (email) => email && !originalOrganizers.current.includes(email)
            );

            if (newOrganizers.length > 0) {
                for (const email of newOrganizers) {
                    try {
                        await supabase.functions.invoke('send-organizer-invite', {
                            body: {
                                eventId: savedEventId,
                                recipientEmail: email,
                                orgId,
                            },
                        });
                    } catch (inviteErr) {
                        console.warn(`Failed to send organizer invite to ${email}:`, inviteErr);
                    }
                }
                // Update the baseline so re-saves don't re-send
                originalOrganizers.current = eventData.notifications.organizers;
            }
        } catch (err) {
            console.error('Error saving event:', err);
            setError(err.message || 'Failed to save event');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" onClick={onBack} type="button">
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-900">
                            {persistedEventId ? 'Edit Event' : 'Create Event'}
                        </h2>
                        {event.eventType === 'parking' && (
                            <span className="text-xs font-semibold rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">Parking</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {saved && <span className="text-sm text-success font-medium">✓ Saved</span>}
                    {persistedEventId && (
                        <Button
                            variant="secondary"
                            onClick={() => {
                                const eventParam = event.slug || persistedEventId;
                                window.open(`${window.location.origin}/?org=${orgId}&event=${eventParam}`, '_blank');
                            }}
                            type="button"
                        >
                            <ExternalLink className="w-4 h-4" /> Preview
                        </Button>
                    )}
                    <Button variant="ghost" onClick={onBack} type="button">
                        Cancel
                    </Button>
                    <Button onClick={handleSave} loading={saving} type="button">
                        <Save className="w-4 h-4" /> Save Event
                    </Button>
                </div>
            </div>

            {error && (
                <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            {/* Event Details */}
            <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    Event Details
                </h3>
                <div className="space-y-4">
                    <div>
                        <Label htmlFor="event-title" required>Event Title</Label>
                        <Input id="event-title" value={event.title} onChange={(e) => handleChange('title', e.target.value)} placeholder="e.g. VBS 2026" />
                    </div>
                    <div>
                        <Label htmlFor="event-slug">
                            URL Slug <span className="text-slate-400 font-normal text-xs">(optional)</span>
                        </Label>
                        <p className="text-xs text-slate-400 mb-1">
                            Appears in your share link: <span className="font-mono">?event=</span>
                            <span className="font-mono text-primary">{event.slug || '<uuid>'}</span>
                        </p>
                        <Input
                            id="event-slug"
                            value={event.slug}
                            onChange={(e) => handleChange('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                            placeholder="e.g. vbs-2026"
                        />
                        {event.slug && !isValidSlug(event.slug) && (
                            <p className="text-xs text-danger mt-1">
                                Slug must be 3–80 characters: lowercase letters, numbers, and hyphens only.
                            </p>
                        )}
                    </div>
                    <div>
                        <Label htmlFor="event-desc">Description</Label>
                        <textarea
                            id="event-desc"
                            value={event.description}
                            onChange={(e) => handleChange('description', e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y"
                            placeholder="Describe this event..."
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="event-location" className="whitespace-nowrap">
                                <MapPin className="w-3 h-3 inline mr-1" />Location / Address
                            </Label>
                            <p className="text-xs text-slate-400 mb-1">Used for calendar links</p>
                            <Input id="event-location" value={event.location} onChange={(e) => handleChange('location', e.target.value)} placeholder="1435 E Main St, Kent, OH 44240" />
                        </div>
                        <div>
                            <Label htmlFor="event-status">Status</Label>
                            <Select
                                id="event-status"
                                value={event.status}
                                onChange={(e) => handleChange('status', e.target.value)}
                                options={[
                                    { value: 'draft', label: 'Draft' },
                                    { value: 'active', label: 'Active' },
                                    { value: 'closed', label: 'Closed' },
                                ]}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <Label htmlFor="event-start">Start Date</Label>
                            <Input id="event-start" type="datetime-local" value={event.startDate} onChange={(e) => handleChange('startDate', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="event-end">End Date</Label>
                            <Input id="event-end" type="datetime-local" value={event.endDate} onChange={(e) => handleChange('endDate', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="event-close">Registration Closes</Label>
                            <Input id="event-close" type="datetime-local" value={event.registrationCloseDate} onChange={(e) => handleChange('registrationCloseDate', e.target.value)} />
                            <p className="text-xs text-slate-400 mt-1">Leave empty for manual control</p>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Appearance */}
            <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Paintbrush className="w-5 h-5 text-primary" />
                    Appearance
                </h3>
                <div className="space-y-6">
                    <div>
                        <Label>Header Image</Label>
                        <p className="text-xs text-slate-400 mb-2">Displayed at the top of the public registration form. 16:9 aspect ratio recommended.</p>
                        <HeaderImageUpload
                            imageUrl={event.headerImageUrl}
                            orgId={orgId}
                            eventId={persistedEventId || 'new'}
                            onChange={(url) => handleChange('headerImageUrl', url)}
                        />
                    </div>
                    <div>
                        <Label>Theme Colors</Label>
                        <p className="text-xs text-slate-400 mb-2">Applied to the registration form header, buttons, and accents.</p>
                        <ThemePicker
                            theme={event.theme}
                            onChange={(theme) => handleChange('theme', theme)}
                        />
                    </div>
                </div>
            </Card>

            {/* Capacity & Payment */}
            <div className="grid grid-cols-2 gap-6">
                <Card className="p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5 text-primary" />
                        Capacity
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="event-capacity">Max Registrations</Label>
                            <Input id="event-capacity" type="number" value={event.capacity} onChange={(e) => handleChange('capacity', e.target.value)} placeholder="Leave empty for unlimited" />
                        </div>
                        <Checkbox
                            label="Enable waitlist when full"
                            checked={event.waitlistEnabled}
                            onChange={(e) => handleChange('waitlistEnabled', e.target.checked)}
                        />
                    </div>
                </Card>

                <Card className="p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                        <CreditCard className="w-5 h-5 text-primary" />
                        Payment
                    </h3>
                    <div className="space-y-4">
                        <Checkbox
                            label="Require payment"
                            checked={event.paymentEnabled}
                            onChange={(e) => handleChange('paymentEnabled', e.target.checked)}
                        />
                        {event.paymentEnabled && (
                            <>
                                <div>
                                    <Label htmlFor="event-amount">Amount ($)</Label>
                                    <Input id="event-amount" type="number" step="0.01" value={event.paymentAmount} onChange={(e) => handleChange('paymentAmount', e.target.value)} />
                                </div>
                                <TithelyConfigurationFields
                                    tithelyGivingUrl={event.tithelyGivingUrl}
                                    tithelyEmbedCode={event.tithelyEmbedCode}
                                    tithelyEmbedConfig={event.tithelyEmbedConfig}
                                    allowInPerson={event.allowInPersonPayment}
                                    onChange={handleChange}
                                />
                                <Checkbox
                                    label="Allow payment in person"
                                    checked={event.allowInPersonPayment}
                                    onChange={(changeEvent) => handleChange('allowInPersonPayment', changeEvent.target.checked)}
                                />
                            </>
                        )}
                    </div>
                </Card>
            </div>

            {/* Organizer Notifications */}
            <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-primary" />
                    Organizer Notifications
                </h3>
                <div className="space-y-4">
                    <div>
                        <Label>Organizer Emails</Label>
                        {event.notifications.organizers.map((email, i) => (
                            <div key={i} className="flex gap-2 mb-2">
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => handleOrganizerEmailChange(i, e.target.value)}
                                    placeholder="organizer@example.org"
                                    className="flex-1"
                                />
                                {event.notifications.organizers.length > 1 && (
                                    <Button variant="ghost" size="sm" onClick={() => removeOrganizerEmail(i)} type="button">×</Button>
                                )}
                            </div>
                        ))}
                        <Button variant="ghost" size="sm" onClick={addOrganizerEmail} type="button" className="text-xs">
                            + Add email
                        </Button>
                    </div>
                    <div className="flex flex-col gap-3">
                        <Checkbox
                            label="Email organizers on each new registration"
                            checked={event.notifications.perRegistration}
                            onChange={(e) => handleNotificationChange('perRegistration', e.target.checked)}
                        />
                        <div className="flex items-center gap-4">
                            <Checkbox
                                label="Weekly digest email"
                                checked={event.notifications.weeklyDigest}
                                onChange={(e) => handleNotificationChange('weeklyDigest', e.target.checked)}
                            />
                            {event.notifications.weeklyDigest && (
                                <Select
                                    value={event.notifications.digestDay}
                                    onChange={(e) => handleNotificationChange('digestDay', e.target.value)}
                                    options={DAYS.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) }))}
                                    className="w-40"
                                />
                            )}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                            <Label htmlFor="reminder-hours" className="whitespace-nowrap text-sm">Send reminder</Label>
                            <Input
                                id="reminder-hours"
                                type="number"
                                min="1"
                                value={event.reminderHoursBefore}
                                onChange={(e) => handleReminderHoursChange(e.target.value)}
                                placeholder="e.g. 24"
                                className="w-24"
                            />
                            <span className="text-sm text-slate-500">hours before event</span>
                        </div>
                        <EventEmailMessageFields
                            confirmationMessage={event.confirmationMessage}
                            reminderMessage={event.reminderMessage}
                            reminderEnabled={hasReminderSchedule(event.reminderHoursBefore)}
                            onChange={handleChange}
                        />
                    </div>
                </div>
            </Card>

            {/* Waiver / E-Sign */}
            <WaiverSection
                waivers={event.waivers}
                onChange={(waivers) => handleChange('waivers', waivers)}
            />

            {/* Form Field Builder */}
            <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Registration Form Fields</h3>
                <FormFieldBuilder
                    fields={event.formFields}
                    onChange={(fields) => handleChange('formFields', fields)}
                />
            </div>

            {/* Live Preview */}
            <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Live Preview</h3>
                <FormPreviewPane eventState={event} />
            </div>
        </div>
    );
}
