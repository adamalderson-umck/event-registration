import React from 'react';
import { CheckCircle2, CalendarDays, ArrowLeft } from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';

export default function SuccessState({ eventTitle, isWaitlisted, onReset }) {
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

            <p className="text-sm text-slate-400 mb-8">
                A confirmation email will be sent shortly with your registration details and a cancellation link.
            </p>

            <Button variant="secondary" onClick={onReset}>
                <ArrowLeft className="w-4 h-4" />
                Register Another
            </Button>
        </Card>
    );
}
