import React from 'react';
import { CalendarDays, MapPin, Users, ArrowRight, Clock } from 'lucide-react';
import Card from './ui/Card';

export default function EventCard({ event, onSelect }) {
    const spotsLeft = event.capacity
        ? event.capacity - (event.registrationCount || 0)
        : null;

    const isFull = event.capacity && spotsLeft <= 0;

    const formatDate = (dateStr) => {
        if (!dateStr) return null;
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    return (
        <Card
            className="p-0 overflow-hidden cursor-pointer group hover:shadow-lg hover:border-primary/30 transition-all duration-300"
            onClick={() => onSelect(event)}
        >
            {/* Color accent bar */}
            <div className="h-1.5 bg-gradient-to-r from-primary to-accent" />

            <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-primary transition-colors line-clamp-2">
                        {event.title}
                    </h3>
                    <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-primary transition-all shrink-0 ml-2 group-hover:translate-x-1" />
                </div>

                {event.description && (
                    <p className="text-sm text-slate-500 mb-4 line-clamp-2">{event.description}</p>
                )}

                <div className="space-y-2 text-sm text-slate-500">
                    {event.startDate && (
                        <div className="flex items-center gap-2">
                            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>
                                {formatDate(event.startDate)}
                                {event.endDate && event.endDate !== event.startDate && (
                                    <> – {formatDate(event.endDate)}</>
                                )}
                            </span>
                        </div>
                    )}

                    {event.location && (
                        <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>{event.location}</span>
                        </div>
                    )}
                </div>

                {/* Capacity Badge */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                    {isFull ? (
                        <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
                                <Clock className="w-3 h-3" />
                                {event.waitlistEnabled ? 'Waitlist Open' : 'Full'}
                            </span>
                            {event.waitlistEnabled && event.waitlistCount > 0 && (
                                <span className="text-xs text-slate-400">
                                    {event.waitlistCount} on waitlist
                                </span>
                            )}
                        </div>
                    ) : spotsLeft !== null ? (
                        <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-success" />
                            <span className="text-sm font-medium text-success">
                                {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} remaining
                            </span>
                        </div>
                    ) : (
                        <span className="text-xs text-slate-400">Open registration</span>
                    )}
                </div>
            </div>
        </Card>
    );
}
