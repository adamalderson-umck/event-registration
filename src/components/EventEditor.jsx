import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import {
    Save, ArrowLeft, CalendarDays, MapPin, Users,
    CreditCard, Bell, Loader2
} from 'lucide-react';
import FormFieldBuilder from './FormFieldBuilder';
import WaiverSection from './WaiverSection';
import { sha256 } from '../utils/hashContent';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import Checkbox from './ui/Checkbox';
import Card from './ui/Card';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function EventEditor({ orgId, eventId, onBack }) {
    const [loading, setLoading] = useState(!!eventId);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const [event, setEvent] = useState({
        title: '',
        description: '',
        location: '',
        startDate: '',
        endDate: '',
        status: 'draft',
        capacity: '',
        waitlistEnabled: false,
        paymentEnabled: false,
        paymentAmount: '',
        formFields: [],
        notifications: {
            organizers: [''],
            perRegistration: false,
            weeklyDigest: false,
            digestDay: 'monday',
        },
        waiver: {
            enabled: false,
            title: '',
            content: '',
        },
    });

    // Load existing event
    useEffect(() => {
        if (!eventId) return;

        const fetchEvent = async () => {
            try {
                const eventRef = doc(db, 'organizations', orgId, 'events', eventId);
                const snap = await getDoc(eventRef);
                if (snap.exists()) {
                    const data = snap.data();
                    setEvent({
                        title: data.title || '',
                        description: data.description || '',
                        location: data.location || '',
                        startDate: data.startDate || '',
                        endDate: data.endDate || '',
                        status: data.status || 'draft',
                        capacity: data.capacity != null ? String(data.capacity) : '',
                        waitlistEnabled: !!data.waitlistEnabled,
                        paymentEnabled: !!data.paymentEnabled,
                        paymentAmount: data.paymentAmount != null ? String(data.paymentAmount) : '',
                        formFields: data.formFields || [],
                        notifications: {
                            organizers: data.notifications?.organizers?.length > 0
                                ? data.notifications.organizers
                                : [''],
                            perRegistration: !!data.notifications?.perRegistration,
                            weeklyDigest: !!data.notifications?.weeklyDigest,
                            digestDay: data.notifications?.digestDay || 'monday',
                        },
                        waiver: {
                            enabled: !!data.waiverEnabled,
                            title: data.waiverTitle || '',
                            content: data.waiverContent || '',
                        },
                    });
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
        setEvent((prev) => ({ ...prev, [key]: value }));
        setSaved(false);
    };

    const handleNotificationChange = (key, value) => {
        setEvent((prev) => ({
            ...prev,
            notifications: { ...prev.notifications, [key]: value },
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
        if (!event.title.trim()) {
            setError('Event title is required');
            return;
        }

        setSaving(true);
        setError('');

        try {
            const eventData = {
                title: event.title.trim(),
                description: event.description.trim(),
                location: event.location.trim(),
                startDate: event.startDate,
                endDate: event.endDate,
                status: event.status,
                capacity: event.capacity ? parseInt(event.capacity) : null,
                waitlistEnabled: event.waitlistEnabled,
                paymentEnabled: event.paymentEnabled,
                paymentAmount: event.paymentAmount ? parseFloat(event.paymentAmount) : null,
                formFields: event.formFields,
                notifications: {
                    organizers: event.notifications.organizers.filter((e) => e.trim() !== ''),
                    perRegistration: event.notifications.perRegistration,
                    weeklyDigest: event.notifications.weeklyDigest,
                    digestDay: event.notifications.digestDay,
                },
                waiverEnabled: event.waiver.enabled,
                waiverTitle: event.waiver.enabled ? event.waiver.title.trim() : '',
                waiverContent: event.waiver.enabled ? event.waiver.content : '',
                waiverContentHash: event.waiver.enabled
                    ? await sha256(event.waiver.content)
                    : '',
                updatedAt: serverTimestamp(),
            };

            if (eventId) {
                // Update existing
                const eventRef = doc(db, 'organizations', orgId, 'events', eventId);
                await setDoc(eventRef, eventData, { merge: true });
            } else {
                // Create new
                eventData.registrationCount = 0;
                eventData.waitlistCount = 0;
                eventData.createdAt = serverTimestamp();
                await addDoc(collection(db, 'organizations', orgId, 'events'), eventData);
            }

            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
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
                    <h2 className="text-xl font-bold text-slate-900">
                        {eventId ? 'Edit Event' : 'Create Event'}
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    {saved && <span className="text-sm text-success font-medium">✓ Saved</span>}
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
                            <Label htmlFor="event-location">
                                <MapPin className="w-3 h-3 inline mr-1" />Location
                            </Label>
                            <Input id="event-location" value={event.location} onChange={(e) => handleChange('location', e.target.value)} placeholder="Fellowship Hall" />
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
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="event-start">Start Date</Label>
                            <Input id="event-start" type="datetime-local" value={event.startDate} onChange={(e) => handleChange('startDate', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="event-end">End Date</Label>
                            <Input id="event-end" type="datetime-local" value={event.endDate} onChange={(e) => handleChange('endDate', e.target.value)} />
                        </div>
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
                            <div>
                                <Label htmlFor="event-amount">Amount ($)</Label>
                                <Input id="event-amount" type="number" step="0.01" value={event.paymentAmount} onChange={(e) => handleChange('paymentAmount', e.target.value)} />
                            </div>
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
                    </div>
                </div>
            </Card>

            {/* Waiver / E-Sign */}
            <WaiverSection
                waiver={event.waiver}
                onChange={(waiver) => handleChange('waiver', waiver)}
            />

            {/* Form Field Builder */}
            <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Registration Form Fields</h3>
                <FormFieldBuilder
                    fields={event.formFields}
                    onChange={(fields) => handleChange('formFields', fields)}
                />
            </div>
        </div>
    );
}
