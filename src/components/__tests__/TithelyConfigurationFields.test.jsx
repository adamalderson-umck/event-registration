import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import TithelyConfigurationFields from '../TithelyConfigurationFields';

const FORM_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_FORM_ID = '123e4567-e89b-42d3-a456-426614174001';
const GIVING_URL = `https://give.tithe.ly/?formId=${FORM_ID}`;
const makeEmbedCode = (formId) => (
    `<button class="tithely-give-button" data-form="${formId}" style="background: #fff">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`
);

describe('TithelyConfigurationFields', () => {
    it('reports URL and embed code edits using the event configuration keys', () => {
        const onChange = vi.fn();
        render(<TithelyConfigurationFields onChange={onChange} />);

        fireEvent.change(screen.getByLabelText('Tithe.ly Giving Form URL'), {
            target: { value: GIVING_URL },
        });
        fireEvent.change(screen.getByLabelText('Tithe.ly Embed Code'), {
            target: { value: '<button>Give</button>' },
        });

        expect(onChange).toHaveBeenNthCalledWith(1, 'tithelyGivingUrl', GIVING_URL);
        expect(onChange).toHaveBeenNthCalledWith(2, 'tithelyEmbedCode', '<button>Give</button>');
    });

    it('shows the saved form ID without repopulating the raw embed textarea', () => {
        render(
            <TithelyConfigurationFields
                tithelyGivingUrl={GIVING_URL}
                tithelyEmbedCode=""
                tithelyEmbedConfig={{ formId: FORM_ID }}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByText(`Configured form: ${FORM_ID}`)).toBeInTheDocument();
        expect(screen.getByLabelText('Tithe.ly Embed Code')).toHaveValue('');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).not.toHaveAttribute('aria-describedby');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).not.toHaveAttribute('aria-describedby');
    });

    it('marks only the URL when the giving URL is invalid', () => {
        render(
            <TithelyConfigurationFields
                tithelyGivingUrl="https://example.com/give"
                tithelyEmbedCode={makeEmbedCode(FORM_ID)}
                allowInPerson
                onChange={vi.fn()}
            />,
        );

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('id', 'event-tithely-configuration-error');
        expect(alert).toHaveTextContent('Pay in Person remains available');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).toHaveAttribute('aria-describedby', 'event-tithely-configuration-error');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).not.toHaveAttribute('aria-describedby');
    });

    it('marks only the embed field when the embed code is invalid', () => {
        render(
            <TithelyConfigurationFields
                tithelyGivingUrl={GIVING_URL}
                tithelyEmbedCode="<button>Give</button>"
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).not.toHaveAttribute('aria-describedby');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).toHaveAttribute('aria-describedby', 'event-tithely-configuration-error');
    });

    it('marks both fields when the URL and embed use different form IDs', () => {
        render(
            <TithelyConfigurationFields
                tithelyGivingUrl={GIVING_URL}
                tithelyEmbedCode={makeEmbedCode(OTHER_FORM_ID)}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('must use the same form ID');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Tithe.ly Giving Form URL')).toHaveAttribute('aria-describedby', 'event-tithely-configuration-error');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Tithe.ly Embed Code')).toHaveAttribute('aria-describedby', 'event-tithely-configuration-error');
    });
});
