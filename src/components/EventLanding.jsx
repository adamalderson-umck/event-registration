import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { CalendarDays, Loader2 } from 'lucide-react';
import EventCard from './EventCard';

export default function EventLanding({ orgId, orgName, onSelectEvent }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(!!orgId);

    useEffect(() => {
        if (!orgId) {
            return;
        }

        // Initial fetch
        const fetchEvents = async () => {
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .eq('org_id', orgId)
                .eq('status', 'active')
                .order('start_date', { ascending: true });

            if (error) {
                console.error('Error fetching events:', error);
            } else {
                setEvents(data || []);
            }
            setLoading(false);
        };

        fetchEvents();

        // Realtime subscription for live updates
        const channel = supabase
            .channel(`landing-events:${orgId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'events',
                    filter: `org_id=eq.${orgId}`,
                },
                (payload) => {
                    if (payload.eventType === 'INSERT' && payload.new.status === 'active') {
                        setEvents((prev) => [...prev, payload.new].sort(
                            (a, b) => new Date(a.start_date) - new Date(b.start_date)
                        ));
                    } else if (payload.eventType === 'UPDATE') {
                        setEvents((prev) => {
                            const updated = prev
                                .map((e) => (e.id === payload.new.id ? payload.new : e))
                                .filter((e) => e.status === 'active');
                            return updated.sort(
                                (a, b) => new Date(a.start_date) - new Date(b.start_date)
                            );
                        });
                    } else if (payload.eventType === 'DELETE') {
                        setEvents((prev) => prev.filter((e) => e.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [orgId]);

    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="text-center mb-10">
                <div className="inline-flex bg-primary/10 p-3 rounded-full mb-4">
                    <CalendarDays className="w-8 h-8 text-primary" />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    {orgName ? `${orgName} Events` : 'Upcoming Events'}
                </h1>
                <p className="text-slate-500">
                    {events.length > 0
                        ? 'Select an event below to register'
                        : 'No events are currently open for registration'
                    }
                </p>
            </div>

            {/* Event Grid */}
            {events.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2">
                    {events.map((event) => (
                        <EventCard
                            key={event.id}
                            event={event}
                            onSelect={onSelectEvent}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <CalendarDays className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                    <p className="text-lg font-semibold text-slate-400">No events yet</p>
                    <p className="text-sm text-slate-300 mt-1">Check back soon for upcoming events</p>
                </div>
            )}
        </div>
    );
}
