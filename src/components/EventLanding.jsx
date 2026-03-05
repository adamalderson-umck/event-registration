import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { CalendarDays, Loader2 } from 'lucide-react';
import EventCard from './EventCard';

export default function EventLanding({ orgId, orgName, onSelectEvent }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!orgId) {
            setLoading(false);
            return;
        }

        const eventsRef = collection(db, 'organizations', orgId, 'events');
        const q = query(
            eventsRef,
            where('status', '==', 'active'),
            orderBy('startDate', 'asc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const eventList = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
            setEvents(eventList);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching events:', error);
            setLoading(false);
        });

        return () => unsubscribe();
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
