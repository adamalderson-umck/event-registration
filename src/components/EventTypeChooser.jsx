import React from 'react';
import { CalendarDays, Car, X } from 'lucide-react';
import { EVENT_TYPES } from '../config/eventPresets';
import Button from './ui/Button';
import Card from './ui/Card';

export default function EventTypeChooser({ onChoose, onCancel }) {
    return (
        <Card className="max-w-2xl mx-auto p-6">
            <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Create Event</h2>
                    <p className="text-sm text-slate-500 mt-1">Choose the registration starting point.</p>
                </div>
                <Button variant="ghost" size="sm" type="button" aria-label="Cancel" onClick={onCancel}>
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <button
                    type="button"
                    onClick={() => onChoose(EVENT_TYPES.STANDARD)}
                    className="text-left p-5 rounded-xl border border-slate-200 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
                >
                    <CalendarDays className="w-6 h-6 text-primary mb-3" />
                    <h3 className="font-semibold text-slate-900">Standard Event</h3>
                    <p className="text-sm text-slate-500 mt-1">Start with the existing core fields.</p>
                </button>
                <button
                    type="button"
                    onClick={() => onChoose(EVENT_TYPES.PARKING)}
                    className="text-left p-5 rounded-xl border border-slate-200 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
                >
                    <Car className="w-6 h-6 text-primary mb-3" />
                    <h3 className="font-semibold text-slate-900">Parking Registration</h3>
                    <p className="text-sm text-slate-500 mt-1">Start with driver, vehicle, payment, and parking agreement defaults.</p>
                </button>
            </div>
        </Card>
    );
}
