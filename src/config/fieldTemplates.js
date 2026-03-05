/**
 * Template field groups for quick form setup.
 * Each template is an array of pre-configured fields that can be
 * added to a form with one click.
 */

export const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

let _templateCounter = 100;
const nextId = () => `tmpl_${++_templateCounter}`;

export const templateGroups = [
    {
        name: 'Name',
        icon: 'User',
        description: 'First and last name fields',
        fields: () => [
            { id: nextId(), type: 'text', label: 'First Name', required: true, placeholder: '' },
            { id: nextId(), type: 'text', label: 'Last Name', required: true, placeholder: '' },
        ],
    },
    {
        name: 'Full Address',
        icon: 'MapPin',
        description: 'Street, city, state, zip',
        fields: () => [
            { id: nextId(), type: 'text', label: 'Street Address', required: true, placeholder: '' },
            { id: nextId(), type: 'text', label: 'City', required: true, placeholder: '' },
            { id: nextId(), type: 'select', label: 'State', required: true, options: US_STATES },
            { id: nextId(), type: 'text', label: 'Zip Code', required: true, placeholder: '' },
        ],
    },
    {
        name: 'Contact Info',
        icon: 'Phone',
        description: 'Email and phone number',
        fields: () => [
            { id: nextId(), type: 'email', label: 'Email Address', required: true, placeholder: '' },
            { id: nextId(), type: 'phone', label: 'Phone Number', required: false, placeholder: '' },
        ],
    },
];

export const fieldTypeOptions = [
    { value: 'text', label: 'Text' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'textarea', label: 'Text Area' },
    { value: 'select', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'checkboxGroup', label: 'Checkbox Group' },
    { value: 'radio', label: 'Radio Buttons' },
];

export const needsOptions = (type) =>
    ['select', 'checkboxGroup', 'radio'].includes(type);
