import React from 'react';
import { CheckCircle2, CalendarDays, ArrowLeft, Calendar } from 'lucide-react';
import { buildGoogleCalendarUrl, downloadIcs } from '../utils/calendarLinks';
import { getParkingPassStatus } from '../utils/parkingRegistration';
import Button from './ui/Button';
import Card from './ui/Card';

export default function SuccessState({ event, registration, isWaitlisted, onReset }) {
    const eventTitle = event?.title || '';
    const isParking = event?.event_type === 'parking';
    const parkingPassStatus = isParking ? getParkingPassStatus(registration) : null;

    return (
        <Card className="max-w-lg mx-auto p-8 text-center">
            <div className={`inline-flex p-4 rounded-full mb-6 ${isWaitlisted ? 'bg-amber-50' : 'bg-green-50'}`}>
                {isWaitlisted ? (
                    <CalendarDays className="w-12 h-12 text-amber-500" />
                ) : (
                    <CheckCircle2 className="w-12 h-12 text-success" />
                )}
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                {isWaitlisted ? 'Added to Waitlist!' : 'Registration Submitted!'}
            </h2>

            <p className="text-slate-500 mb-2">
                {isWaitlisted
                    ? `You've been added to the waitlist for "${eventTitle}". We'll notify you if a spot opens up.`
                    : `Your registration for "${eventTitle}" has been received.`
                }
            </p>

            <p className="text-sm text-slate-400 mb-6">
                A confirmation email will be sent shortly with your registration details and a cancellation link.
            </p>

            {!isWaitlisted && registration?.payment_method === 'in_person' && registration?.payment_status === 'pending' && (
                <p className="text-sm font-semibold text-slate-700 mb-6">
                    Payment is pending. Please pay in person; an administrator will verify your payment.
                </p>
            )}

            {!isWaitlisted && registration?.payment_method === 'tithely' && registration?.payment_status === 'pending' && (
                <p className="text-sm font-semibold text-slate-700 mb-6">
                    Your Tithe.ly payment is pending administrator verification.
                </p>
            )}

            {isParking && (
                <p className="text-sm font-semibold text-slate-700 mb-6">
                    {parkingPassStatus}
                </p>
            )}

            {event?.event_type !== 'parking' && event?.start_date && !isWaitlisted && (
                <div className="flex justify-center gap-4 mb-6">
                    <a
                        href={buildGoogleCalendarUrl(event)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                        <Calendar className="w-4 h-4" /> Google Calendar
                    </a>
                    <button
                        onClick={() => downloadIcs(event)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline cursor-pointer"
                    >
                        <Calendar className="w-4 h-4" /> Download .ics
                    </button>
                </div>
            )}

            <Button variant="secondary" onClick={onReset}>
                <ArrowLeft className="w-4 h-4" />
                Register Another
            </Button>
        </Card>
    );
}
