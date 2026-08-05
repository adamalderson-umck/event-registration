import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import TithelyConfigurationFields from '../TithelyConfigurationFields';

const FORM_ID = '123e4567-e89b-42d3-a456-426614174000';
const GIVING_URL = `https://give.tithe.ly/?formId=${FORM_ID}`;

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
    });

    it('keeps in-person payment available when the draft configuration is invalid', () => {
        render(
            <TithelyConfigurationFields
                tithelyGivingUrl="https://example.com/give"
                tithelyEmbedCode={'<script data-testid="untrusted-code">alert(1)</script>'}
                allowInPerson
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Pay in Person remains available');
        expect(screen.queryByTestId('untrusted-code')).not.toBeInTheDocument();
    });
});
