import React from 'react';
import Label from './ui/Label';

const textareaClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';

export default function EventEmailMessageFields({
    confirmationMessage,
    reminderMessage,
    reminderEnabled,
    onChange,
}) {
    return (
        <div className="space-y-5">
            <div>
                <Label htmlFor="confirmation-message">Confirmation Email Message</Label>
                <p className="text-xs text-slate-500 mb-1">
                    The email automatically adds registration status, event and registration details,
                    the cancellation link, and parking payment facts. Add accurate pickup details and
                    any other event-specific instructions here.
                </p>
                <textarea
                    id="confirmation-message"
                    rows={5}
                    className={textareaClass}
                    value={confirmationMessage || ''}
                    onChange={(event) => onChange('confirmationMessage', event.target.value)}
                />
            </div>
            <div>
                <Label htmlFor="reminder-message">Reminder Email Message</Label>
                <p className="text-xs text-slate-500 mb-1">
                    The email automatically adds the event date, time, location, calendar link,
                    and parking payment facts.
                </p>
                {!reminderEnabled && (
                    <p className="text-xs text-slate-500 mb-1">
                        Set a reminder time to edit this message.
                    </p>
                )}
                <textarea
                    id="reminder-message"
                    rows={5}
                    className={textareaClass}
                    value={reminderMessage || ''}
                    disabled={!reminderEnabled}
                    onChange={(event) => onChange('reminderMessage', event.target.value)}
                />
            </div>
        </div>
    );
}
