import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TithelyFallbackButton from '../TithelyFallbackButton';

const SCRIPT_URL = 'https://static.tithely.com/give/give.js';
const config = {
    formId: '59b0fe48-e075-436e-a91e-88011a19d975',
    locationId: 'c9f19096-4a76-4ea1-be56-d7f16d1e5241',
    fundId: 'c4c11990-779e-4582-ba46-bf510ed3a37f',
    amount: '10000',
    frequency: 'one-time',
};

afterEach(() => {
    cleanup();
    document.querySelectorAll(`script[src="${SCRIPT_URL}"]`).forEach(script => script.remove());
});

describe('TithelyFallbackButton', () => {
    it('reconstructs only validated provider data attributes', () => {
        render(<TithelyFallbackButton embedConfig={config} />);

        const button = screen.getByRole('button', { name: 'Pay with Tithe.ly' });
        expect(button).toHaveClass('tithely-give-button');
        expect(button).toHaveAttribute('data-form', config.formId);
        expect(button).toHaveAttribute('data-location', config.locationId);
        expect(button).toHaveAttribute('data-fund', config.fundId);
        expect(button).toHaveAttribute('data-amount', config.amount);
        expect(button).toHaveAttribute('data-frequency', config.frequency);
        expect(button).not.toHaveAttribute('style');
    });

    it('omits optional attributes when a legacy configuration has only a form ID', () => {
        render(<TithelyFallbackButton embedConfig={{ formId: config.formId }} />);

        const button = screen.getByRole('button', { name: 'Pay with Tithe.ly' });
        expect(button).toHaveAttribute('data-form', config.formId);
        expect(button).not.toHaveAttribute('data-location');
        expect(button).not.toHaveAttribute('data-fund');
        expect(button).not.toHaveAttribute('data-amount');
        expect(button).not.toHaveAttribute('data-frequency');
    });

    it('loads the fixed deferred provider script only once', () => {
        const { rerender } = render(<TithelyFallbackButton embedConfig={config} />);
        rerender(<TithelyFallbackButton embedConfig={config} />);

        const scripts = document.querySelectorAll(`script[src="${SCRIPT_URL}"]`);
        expect(scripts).toHaveLength(1);
        expect(scripts[0]).toHaveAttribute('defer');
        expect(scripts[0]).toHaveAttribute('data-tithely-fallback-script', 'true');
    });
});
