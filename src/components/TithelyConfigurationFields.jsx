import React from 'react';
import { getTithelyDraftStatus, TITHELY_ERROR_CODES } from '../utils/tithelyEmbed';
import Input from './ui/Input';
import Label from './ui/Label';

const ERROR_ID = 'event-tithely-configuration-error';

export default function TithelyConfigurationFields({
    tithelyGivingUrl = '',
    tithelyEmbedCode = '',
    tithelyEmbedConfig = null,
    allowInPerson = false,
    onChange,
}) {
    const draftStatus = getTithelyDraftStatus({
        givingUrl: tithelyGivingUrl,
        embedCode: tithelyEmbedCode,
        existingEmbedConfig: tithelyEmbedConfig,
    });
    const hasError = Boolean(
        draftStatus.error && (tithelyGivingUrl || tithelyEmbedCode || tithelyEmbedConfig),
    );
    const urlHasError = hasError && (
        [
            TITHELY_ERROR_CODES.MISSING_URL,
            TITHELY_ERROR_CODES.INVALID_URL,
            TITHELY_ERROR_CODES.INVALID_FORM_ID,
            TITHELY_ERROR_CODES.MISMATCH,
        ].includes(draftStatus.errorCode)
    );
    const embedHasError = hasError && (
        [
            TITHELY_ERROR_CODES.MISSING_EMBED,
            TITHELY_ERROR_CODES.INVALID_EMBED,
            TITHELY_ERROR_CODES.MISMATCH,
        ].includes(draftStatus.errorCode)
    );

    return (
        <div className="space-y-3">
            <div>
                <Label htmlFor="event-tithely-url">Tithe.ly Giving Form URL</Label>
                <Input
                    id="event-tithely-url"
                    type="url"
                    value={tithelyGivingUrl}
                    onChange={(event) => onChange('tithelyGivingUrl', event.target.value)}
                    placeholder="https://give.tithe.ly/?formId=..."
                    aria-invalid={urlHasError ? 'true' : undefined}
                    aria-describedby={urlHasError ? ERROR_ID : undefined}
                />
            </div>
            <div>
                <Label htmlFor="event-tithely-embed">Tithe.ly Embed Code</Label>
                <textarea
                    id="event-tithely-embed"
                    value={tithelyEmbedCode}
                    onChange={(event) => onChange('tithelyEmbedCode', event.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y font-mono text-xs"
                    placeholder="Paste the official Tithe.ly embed code"
                    aria-invalid={embedHasError ? 'true' : undefined}
                    aria-describedby={embedHasError ? ERROR_ID : undefined}
                />
            </div>
            <p className="text-xs text-slate-500">
                Embed code is validated only; raw pasted HTML/scripts are neither stored nor executed.
            </p>
            {draftStatus.configured && !tithelyEmbedCode.trim() && (
                <p className="text-xs text-success">Configured form: {draftStatus.embedConfig.formId}</p>
            )}
            {hasError && (
                <p id={ERROR_ID} role="alert" className="text-xs text-danger">
                    {draftStatus.error}{allowInPerson ? ' Pay in Person remains available.' : ''}
                </p>
            )}
        </div>
    );
}
