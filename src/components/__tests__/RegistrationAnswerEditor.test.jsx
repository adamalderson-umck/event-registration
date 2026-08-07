import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistrationAnswerEditor from '../RegistrationAnswerEditor';

const fields = [
  { id: 'section', type: 'sectionBreak', label: 'Vehicle' },
  { id: 'email', type: 'email', label: 'Email', required: true },
  {
    id: 'kind',
    type: 'radio',
    label: 'Tag Type',
    required: true,
    options: ['Temporary', 'Permanent'],
  },
  {
    id: 'plate',
    type: 'text',
    label: 'License Plate',
    required: true,
    condition: { field: 'kind', operator: 'equals', value: 'Permanent' },
  },
];

function renderEditor(overrides = {}) {
  const props = {
    formFields: fields,
    savedFormData: {
      email: 'alex@example.org',
      kind: 'Temporary',
      retired: 'Legacy value',
    },
    saving: false,
    saveError: '',
    onDirtyChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<RegistrationAnswerEditor {...props} />);
  return props;
}

describe('RegistrationAnswerEditor', () => {
  it('shows sections, current controls, and legacy read-only answers', () => {
    renderEditor();

    expect(screen.getByRole('heading', { name: 'Vehicle' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveValue('alex@example.org');
    expect(screen.getByRole('radio', { name: 'Temporary' })).toBeChecked();
    expect(screen.queryByLabelText(/^License Plate/)).not.toBeInTheDocument();
    expect(screen.getByText('Legacy answers (read-only)')).toBeInTheDocument();
    expect(screen.getByText('retired')).toBeInTheDocument();
    expect(screen.getByText('Legacy value')).toBeInTheDocument();
  });

  it('reveals conditions, validates inline, and saves only visible current answers', async () => {
    const user = userEvent.setup();
    const props = renderEditor();

    await user.click(screen.getByRole('radio', { name: 'Permanent' }));
    await user.clear(screen.getByLabelText(/^Email/));
    await user.type(screen.getByLabelText(/^Email/), 'bad');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^Email/));
    await user.type(screen.getByLabelText(/^Email/), 'alex@example.org');
    await user.type(screen.getByLabelText(/^License Plate/), 'ABC123');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(props.onSave).toHaveBeenCalledWith({
      email: 'alex@example.org',
      kind: 'Permanent',
      plate: 'ABC123',
    });
  });

  it('reports dirty state and delegates cancellation', async () => {
    const user = userEvent.setup();
    const props = renderEditor();

    expect(props.onDirtyChange).toHaveBeenCalledWith(false);
    await user.click(screen.getByRole('radio', { name: 'Permanent' }));
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Cancel Editing' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders server errors and disables all actions while saving', () => {
    renderEditor({ saving: true, saveError: 'Unable to save these changes.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save these changes.');
    expect(screen.getByLabelText(/^Email/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel Editing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('renders every supported field type through DynamicField', () => {
    const supported = [
      { id: 'text', type: 'text', label: 'Text' },
      { id: 'email', type: 'email', label: 'Email' },
      { id: 'phone', type: 'phone', label: 'Phone' },
      { id: 'number', type: 'number', label: 'Number' },
      { id: 'date', type: 'date', label: 'Date' },
      { id: 'textarea', type: 'textarea', label: 'Notes' },
      { id: 'select', type: 'select', label: 'Select', options: ['A'] },
      { id: 'radio', type: 'radio', label: 'Radio', options: ['B'] },
      { id: 'checkbox', type: 'checkbox', label: 'Checkbox' },
      { id: 'group', type: 'checkboxGroup', label: 'Group', options: ['C'] },
    ];

    renderEditor({ formFields: supported, savedFormData: {} });

    for (const label of ['Text', 'Email', 'Phone', 'Number', 'Date', 'Notes', 'Select']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Checkbox' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'C' })).toBeInTheDocument();
  });
});
