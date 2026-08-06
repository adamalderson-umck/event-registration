import React, { useEffect } from 'react';
import { TITHELY_SCRIPT_URL } from '../utils/tithelyEmbed';

export default function TithelyFallbackButton({ embedConfig }) {
    useEffect(() => {
        if (document.querySelector(`script[src="${TITHELY_SCRIPT_URL}"]`)) {
            return;
        }

        const script = document.createElement('script');
        script.src = TITHELY_SCRIPT_URL;
        script.defer = true;
        script.dataset.tithelyFallbackScript = 'true';
        document.body.appendChild(script);
    }, []);

    return (
        <button
            type="button"
            className="tithely-give-button inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/50"
            data-form={embedConfig.formId}
            data-location={embedConfig.locationId}
            data-fund={embedConfig.fundId}
            data-amount={embedConfig.amount}
            data-frequency={embedConfig.frequency}
        >
            Pay with Tithe.ly
        </button>
    );
}
