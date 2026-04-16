import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useOrg } from '../context/useOrg';
import {
    CalendarDays, Users, BarChart3, Plus,
    Settings, LogOut, Loader2, Building2, Share2, Copy, Eye, UserCircle
} from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import OrgPicker from './OrgPicker';
import CreateOrg from './CreateOrg';
import ShareEventModal from './ShareEventModal';
import EventDonutChart from './EventDonutChart';

// Lazy-loaded sub-views
const EventEditor = React.lazy(() => import('./EventEditor'));
const RegistrationViewer = React.lazy(() => import('./RegistrationViewer'));
const OrgSettings = React.lazy(() => import('./OrgSettings'));
const UserSettings = React.lazy(() => import('./UserSettings'));

export default function AdminDashboard() {
    const { currentOrg, setCurrentOrg } = useOrg();
    const [orgs, setOrgs] = useState([]);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [subView, setSubView] = useState(null); // 'editor', 'registrations', 'settings', 'create-org'
    const [selectedEventId, setSelectedEventId] = useState(null);
    const [shareEvent, setShareEvent] = useState(null);

    // Fetch user's organizations
    useEffect(() => {
        const fetchOrgs = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            try {
                const { data, error } = await supabase
                    .from('org_members')
                    .select('org_id, role, organizations(id, name, slug, owner_uid, smtp_config, created_at, updated_at)')
                    .eq('user_id', user.id);

                if (error) throw error;

                const orgList = data.map((m) => ({ ...m.organizations, memberRole: m.role }));
                setOrgs(orgList);

                if (orgList.length === 1) {
                    setCurrentOrg(orgList[0]);
                }
            } catch (err) {
                console.error('Error fetching orgs:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchOrgs();
    }, [setCurrentOrg]);

    // Fetch events for current org + Realtime subscription
    useEffect(() => {
        if (!currentOrg) return;

        // Initial fetch
        const fetchEvents = async () => {
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('org_id', currentOrg.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching events:', error);
                return;
            }
            setEvents(data || []);
        };

        fetchEvents();

        // Realtime subscription for live updates
        const channel = supabase
            .channel(`events:${currentOrg.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'events',
                    filter: `org_id=eq.${currentOrg.id}`,
                },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        setEvents((prev) => [payload.new, ...prev]);
                    } else if (payload.eventType === 'UPDATE') {
                        setEvents((prev) =>
                            prev.map((e) => (e.id === payload.new.id ? { ...e, ...payload.new } : e))
                        );
                    } else if (payload.eventType === 'DELETE') {
                        setEvents((prev) => prev.filter((e) => e.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentOrg]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        window.location.href = '/?admin=true';
    };

    const handleDuplicate = async (sourceEvent) => {
        try {
            const { id: _id, created_at: _ca, updated_at: _ua, registration_count: _rc, waitlist_count: _wc, reminder_sent_at: _rs, ...rest } = sourceEvent;
            const newEvent = {
                ...rest,
                title: `${sourceEvent.title} (Copy)`,
                status: 'draft',
                registration_count: 0,
                waitlist_count: 0,
                reminder_sent_at: null,
            };

            const { error } = await supabase.from('events').insert(newEvent);
            if (error) throw error;
            // Realtime subscription will auto-add the new event to the list
        } catch (err) {
            console.error('Error duplicating event:', err);
            alert('Failed to duplicate event');
        }
    };

    // Loading
    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    // No orgs — show create org (and Join Demo in dev mode)
    if (orgs.length === 0) {
        return (
            <div className="py-8">
                <div className="text-center mb-8">
                    <p className="text-slate-500">You're not part of any organization yet.</p>
                </div>
                {import.meta.env.DEV && (
                    <div className="max-w-lg mx-auto mb-8">
                        <Card className="p-6 text-center border-dashed border-2 border-primary/30 bg-primary/5">
                            <div className="flex items-center justify-center gap-2 mb-2">
                                <span className="text-lg">🧪</span>
                                <h3 className="text-lg font-bold text-slate-900">Demo Mode</h3>
                            </div>
                            <p className="text-sm text-slate-500 mb-4">
                                Join the pre-seeded demo organization to test the dashboard with sample events and registrations.
                            </p>
                            <Button
                                onClick={async () => {
                                    try {
                                        setLoading(true);
                                        const { error } = await supabase.rpc('join_demo_org');
                                        if (error) throw error;

                                        // Re-fetch orgs
                                        const { data: { user } } = await supabase.auth.getUser();
                                        const { data: memberData } = await supabase
                                            .from('org_members')
                                            .select('org_id, role, organizations(id, name, slug, owner_uid, smtp_config, created_at, updated_at)')
                                            .eq('user_id', user.id);

                                        const orgList = memberData.map((m) => ({ ...m.organizations, memberRole: m.role }));
                                        setOrgs(orgList);
                                        if (orgList.length >= 1) setCurrentOrg(orgList[0]);
                                    } catch (err) {
                                        console.error('Failed to join demo org:', err);
                                        alert('Failed to join demo org. Make sure you\'ve run: npm run seed:demo');
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                className="w-full"
                            >
                                <Building2 className="w-4 h-4" />
                                Join Demo Organization
                            </Button>
                        </Card>
                    </div>
                )}
                <CreateOrg
                    onCreated={(org) => {
                        setOrgs([org]);
                        setCurrentOrg(org);
                    }}
                />
            </div>
        );
    }

    // Org picker (multiple orgs, none selected)
    if (!currentOrg && orgs.length > 1) {
        return (
            <div className="py-8">
                <OrgPicker orgs={orgs} onSelect={(org) => setCurrentOrg(org)} />
                <div className="text-center mt-6">
                    <Button variant="ghost" onClick={() => setSubView('create-org')}>
                        <Plus className="w-4 h-4" /> Create New Organization
                    </Button>
                </div>
                {subView === 'create-org' && (
                    <div className="mt-8">
                        <CreateOrg
                            onCreated={(org) => {
                                setOrgs((prev) => [...prev, org]);
                                setCurrentOrg(org);
                                setSubView(null);
                            }}
                        />
                    </div>
                )}
            </div>
        );
    }

    // Sub-views
    if (subView === 'editor') {
        return (
            <React.Suspense fallback={<Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mt-12" />}>
                <EventEditor
                    orgId={currentOrg.id}
                    eventId={selectedEventId}
                    onBack={() => { setSubView(null); setSelectedEventId(null); }}
                />
            </React.Suspense>
        );
    }

    if (subView === 'registrations') {
        return (
            <React.Suspense fallback={<Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mt-12" />}>
                <RegistrationViewer
                    orgId={currentOrg.id}
                    eventId={selectedEventId}
                    event={events.find((e) => e.id === selectedEventId)}
                    onBack={() => { setSubView(null); setSelectedEventId(null); }}
                />
            </React.Suspense>
        );
    }

    if (subView === 'settings') {
        return (
            <React.Suspense fallback={<Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mt-12" />}>
                <OrgSettings onBack={() => setSubView(null)} />
            </React.Suspense>
        );
    }

    if (subView === 'my-profile') {
        return (
            <React.Suspense fallback={<Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mt-12" />}>
                <div className="mb-6 flex justify-end">
                    <Button variant="ghost" onClick={() => setSubView(null)}>← Back to Dashboard</Button>
                </div>
                <UserSettings />
            </React.Suspense>
        );
    }

    // Calculate metrics
    const activeEvents = events.filter((e) => e.status === 'active').length;

    const statusColors = {
        active: 'bg-green-50 text-green-700 border-green-200',
        draft: 'bg-slate-100 text-slate-600 border-slate-200',
        closed: 'bg-red-50 text-red-700 border-red-200',
    };

    const handleStatusChange = async (eventId, newStatus) => {
        // Capture previous state for rollback
        const previousEvents = events;
        // Optimistic update — immediately reflect in the UI
        setEvents((prev) =>
            prev.map((e) => (e.id === eventId ? { ...e, status: newStatus } : e))
        );
        try {
            const { error } = await supabase
                .from('events')
                .update({ status: newStatus })
                .eq('id', eventId);
            if (error) throw error;
        } catch (err) {
            console.error('Error updating status:', err);
            // Revert on failure
            setEvents(previousEvents);
            alert('Failed to update status');
        }
    };

    const getPreviewUrl = (eventId) => {
        return `${window.location.origin}/?org=${currentOrg.id}&event=${eventId}`;
    };

    return (
        <div className="space-y-6">
            {/* Top Bar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-primary" />
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">{currentOrg.name}</h1>
                        {orgs.length > 1 && (
                            <button
                                onClick={() => setCurrentOrg(null)}
                                className="text-xs text-primary hover:underline cursor-pointer"
                            >
                                Switch organization
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSubView('my-profile')} title="My Profile">
                        <UserCircle className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSubView('settings')} title="Organization Settings">
                        <Settings className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleSignOut} title="Sign Out">
                        <LogOut className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-4">
                    <Card className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-primary/10 p-2 rounded-lg">
                                <CalendarDays className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{events.length}</p>
                                <p className="text-xs text-slate-500">Total Events</p>
                            </div>
                        </div>
                    </Card>
                    <Card className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-green-50 p-2 rounded-lg">
                                <BarChart3 className="w-5 h-5 text-success" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-slate-900">{activeEvents}</p>
                                <p className="text-xs text-slate-500">Active Events</p>
                            </div>
                        </div>
                    </Card>
                </div>
                <Card className="p-4 md:col-span-2">
                    <h3 className="text-sm font-semibold text-slate-600 mb-3">Registrations by Event</h3>
                    <EventDonutChart events={events} />
                </Card>
            </div>

            {/* Events List */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Events</h2>
                <Button
                    onClick={() => {
                        setSelectedEventId(null);
                        setSubView('editor');
                    }}
                    size="sm"
                >
                    <Plus className="w-4 h-4" />
                    Create Event
                </Button>
            </div>

            {events.length === 0 ? (
                <Card className="p-12 text-center">
                    <CalendarDays className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-lg font-semibold text-slate-400">No events yet</p>
                    <p className="text-sm text-slate-300 mt-1">Create your first event to get started</p>
                </Card>
            ) : (
                <div className="space-y-3">
                    {events.map((event) => (
                        <Card key={event.id} className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-semibold text-slate-900 truncate">{event.title}</h3>
                                            <select
                                                value={event.status}
                                                onChange={(e) => handleStatusChange(event.id, e.target.value)}
                                                className={`text-xs font-medium px-2 py-0.5 rounded-full border cursor-pointer appearance-none pr-5 bg-size-[12px] bg-position-[right_4px_center] bg-no-repeat ${statusColors[event.status] || statusColors.draft}`}
                                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
                                            >
                                                <option value="draft">Draft</option>
                                                <option value="active">Active</option>
                                                <option value="closed">Closed</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-slate-400">
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" />
                                                {event.registration_count || 0} registered
                                                {event.capacity && ` / ${event.capacity}`}
                                            </span>
                                            {event.start_date && (
                                                <span className="flex items-center gap-1">
                                                    <CalendarDays className="w-3 h-3" />
                                                    {new Date(event.start_date).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => window.open(getPreviewUrl(event.id), '_blank')}
                                        title="Preview form"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShareEvent(event)}
                                        title="Share"
                                    >
                                        <Share2 className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDuplicate(event)}
                                        title="Duplicate"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setSelectedEventId(event.id);
                                            setSubView('registrations');
                                        }}
                                    >
                                        Registrations
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => {
                                            setSelectedEventId(event.id);
                                            setSubView('editor');
                                        }}
                                    >
                                        Edit
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {shareEvent && (
                <ShareEventModal
                    event={shareEvent}
                    orgId={currentOrg.id}
                    onClose={() => setShareEvent(null)}
                />
            )}
        </div>
    );
}
