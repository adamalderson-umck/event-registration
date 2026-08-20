import React, { useEffect, useMemo, useState } from 'react';
import DynamicField from './DynamicField';
import Button from './ui/Button';
import { splitIntoPages } from '../utils/formConditions';
import {
    buildAnswerDraft,
    getLegacyAnswers,
    getVisibleFields,
    isAnswerDraftDirty,
    prepareVisibleAnswers,
    validateAnswerDraft,
} from '../utils/registrationAnswerForm';
import {
    PARKING_LICENSE_PLATE_FIELD_ID,
    normalizeLicensePlate,
} from '../utils/licensePlate';

const formatValue = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
};

export default function RegistrationAnswerEditor({
    formFields = [],
    savedFormData = {},
    saving,
    saveError,
    onDirtyChange,
    onSave,
    onCancel,
}) {
    const [draft, setDraft] = useState(() => buildAnswerDraft(formFields, savedFormData));
    const [errors, setErrors] = useState({});

    const pages = useMemo(() => splitIntoPages(formFields), [formFields]);
    const visibleIds = useMemo(() => new Set(
        getVisibleFields(formFields, draft).map((field) => field.id),
    ), [formFields, draft]);
    const legacyAnswers = useMemo(
        () => getLegacyAnswers(formFields, savedFormData),
        [formFields, savedFormData],
    );
    const dirty = isAnswerDraftDirty(formFields, savedFormData, draft);

    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    const handleChange = (fieldId, value) => {
        setDraft((current) => ({ ...current, [fieldId]: value }));
        setErrors((current) => {
            if (!current[fieldId]) return current;
            const next = { ...current };
            delete next[fieldId];
            return next;
        });
    };

    const handleBlur = (fieldId, value) => {
        if (fieldId !== PARKING_LICENSE_PLATE_FIELD_ID) return;
        handleChange(fieldId, normalizeLicensePlate(value));
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        const nextErrors = validateAnswerDraft(formFields, draft);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) {
            onSave(prepareVisibleAnswers(formFields, draft));
        }
    };

    const legacyEntries = Object.entries(legacyAnswers);

    return (
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            {pages.map((page, pageIndex) => (
                <section key={`${page.title || 'fields'}-${pageIndex}`} className="space-y-4">
                    {page.title && (
                        <h4 className="text-base font-semibold text-slate-900">{page.title}</h4>
                    )}
                    {page.fields.filter((field) => visibleIds.has(field.id)).map((field) => (
                        <DynamicField
                            key={field.id}
                            field={field}
                            value={draft[field.id]}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            error={errors[field.id]}
                            disabled={saving}
                        />
                    ))}
                </section>
            ))}

            {legacyEntries.length > 0 && (
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h4 className="text-sm font-semibold text-slate-700">
                        Legacy answers (read-only)
                    </h4>
                    <dl className="mt-3 space-y-2">
                        {legacyEntries.map(([fieldId, value]) => (
                            <div key={fieldId} className="grid grid-cols-3 gap-2 text-sm">
                                <dt className="font-medium text-slate-500">{fieldId}</dt>
                                <dd className="col-span-2 text-slate-700">{formatValue(value)}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}

            {saveError && (
                <p role="alert" className="text-sm text-danger">{saveError}</p>
            )}

            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={onCancel}
                >
                    Cancel Editing
                </Button>
                <Button type="submit" loading={saving}>
                    Save Changes
                </Button>
            </div>
        </form>
    );
}
