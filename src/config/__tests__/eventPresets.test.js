import { describe, expect, it } from 'vitest';
import {
    EVENT_TYPES,
    PARKING_FIELD_IDS,
    PARKING_FIELDS,
    SYSTEM_FIELDS,
    createEventPreset,
    validateParkingEventDraft,
    validateParkingEventRecord,
} from '../eventPresets';
import { US_STATES } from '../fieldTemplates';

describe('event presets', () => {
    it('creates the standard preset', () => {
        const preset = createEventPreset(EVENT_TYPES.STANDARD);

        expect(preset.eventType).toBe('standard');
        expect(preset.formFields.map(field => field.id)).toEqual([
            'system_first_name',
            'system_last_name',
            'system_email',
        ]);
        expect(preset.waivers).toEqual([]);
        expect(preset.paymentEnabled).toBe(false);
        expect(preset.allowInPersonPayment).toBe(false);
        expect(preset.confirmationMessage).toBe('');
    });

    it('creates the parking preset', () => {
        const preset = createEventPreset(EVENT_TYPES.PARKING);
        const fieldIds = preset.formFields.map(field => field.id);
        const licensePlate = preset.formFields.find(field => field.id === PARKING_FIELD_IDS.LICENSE_PLATE);

        expect(new Set(fieldIds).size).toBe(fieldIds.length);
        expect(fieldIds).toContain(PARKING_FIELD_IDS.LICENSE_PLATE);
        expect(fieldIds).toContain(PARKING_FIELD_IDS.VEHICLE_MAKE);
        expect(licensePlate).toMatchObject({ required: true, system: true });
        expect(preset.formFields.slice(3)).toEqual([
            { id: PARKING_FIELD_IDS.PHONE, type: 'phone', label: 'Phone Number', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.LOCAL_STREET, type: 'text', label: 'Local Street Address', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.LOCAL_CITY, type: 'text', label: 'Local City', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.LOCAL_STATE, type: 'select', label: 'Local State', required: true, system: true, placeholder: '', options: US_STATES },
            { id: PARKING_FIELD_IDS.LOCAL_ZIP, type: 'text', label: 'Local ZIP Code', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.PERMANENT_STREET, type: 'text', label: 'Permanent Street Address', required: false, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.PERMANENT_CITY, type: 'text', label: 'Permanent City', required: false, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.PERMANENT_STATE, type: 'select', label: 'Permanent State', required: false, system: true, placeholder: '', options: US_STATES },
            { id: PARKING_FIELD_IDS.PERMANENT_ZIP, type: 'text', label: 'Permanent ZIP Code', required: false, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.VEHICLE_YEAR, type: 'number', label: 'Vehicle Year', required: false, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.VEHICLE_MAKE, type: 'text', label: 'Vehicle Make', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.VEHICLE_MODEL, type: 'text', label: 'Vehicle Model', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.VEHICLE_COLOR, type: 'text', label: 'Vehicle Color', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.LICENSE_PLATE, type: 'text', label: 'License Plate', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.REGISTRATION_STATE, type: 'select', label: 'Vehicle Registration State', required: true, system: true, placeholder: '', options: US_STATES },
            { id: PARKING_FIELD_IDS.REGISTRATION_COUNTY, type: 'text', label: 'Vehicle Registration County', required: true, system: true, placeholder: '' },
            { id: PARKING_FIELD_IDS.INSURANCE_PROVIDER, type: 'text', label: 'Insurance Provider', required: true, system: true, placeholder: '' },
        ]);
        expect(preset.waivers).toEqual([expect.objectContaining({
            id: 'parking_rules_agreement',
            title: 'Parking Rules and Agreement',
            required: true,
        })]);
        expect(preset.paymentEnabled).toBe(true);
        expect(preset.allowInPersonPayment).toBe(true);
        expect(preset.confirmationMessage).toBe('Thank you for registering for this parking event.');
    });

    it('returns independent preset copies', () => {
        const first = createEventPreset(EVENT_TYPES.PARKING);
        first.formFields[0].label = 'Changed';
        first.waivers[0].title = 'Changed waiver';

        const second = createEventPreset(EVENT_TYPES.PARKING);
        expect(second.formFields[0].label).toBe('Your First Name');
        expect(second.waivers[0].title).toBe('Parking Rules and Agreement');
    });

    it('keeps templates immutable while returning mutable preset copies', () => {
        const localStateTemplate = PARKING_FIELDS.find(field => field.id === PARKING_FIELD_IDS.LOCAL_STATE);

        try {
            SYSTEM_FIELDS[0].label = 'Changed template';
        } catch {
            // Frozen module exports throw on assignment in strict runtimes.
        }
        try {
            localStateTemplate.options.push('ZZ');
        } catch {
            // Frozen nested options throw on mutation in strict runtimes.
        }

        expect(SYSTEM_FIELDS[0].label).toBe('Your First Name');
        expect(localStateTemplate.options).toEqual(US_STATES);

        const later = createEventPreset(EVENT_TYPES.PARKING);
        expect(later.formFields[0].label).toBe('Your First Name');
        expect(later.formFields.find(field => field.id === PARKING_FIELD_IDS.LOCAL_STATE).options).toEqual(US_STATES);
    });

    it('validates parking presets and persisted parking records', () => {
        const preset = createEventPreset(EVENT_TYPES.PARKING);
        expect(validateParkingEventDraft({
            ...preset,
            paymentEnabled: true,
            paymentAmount: '100',
        })).toEqual([]);

        const invalid = validateParkingEventDraft({
            ...preset,
            paymentEnabled: false,
            paymentAmount: '',
            formFields: preset.formFields.map(field => (
                field.id === PARKING_FIELD_IDS.LICENSE_PLATE
                    ? { ...field, system: false }
                    : field
            )),
            waivers: [],
        });
        expect(invalid).toEqual([
            'Parking events require payment with a positive amount.',
            'Missing required parking field: License Plate.',
            'Parking events require the Parking Rules and Agreement waiver.',
        ]);

        const weakenedFields = preset.formFields.map(field => (
            field.id === PARKING_FIELD_IDS.LICENSE_PLATE
                ? { ...field, required: false }
                : field
        ));
        expect(validateParkingEventDraft({
            ...preset,
            paymentEnabled: true,
            paymentAmount: '100',
            formFields: weakenedFields,
        })).toEqual(['Missing required parking field: License Plate.']);

        const conditionalFields = preset.formFields.map(field => (
            field.id === PARKING_FIELD_IDS.LICENSE_PLATE
                ? { ...field, condition: { field: PARKING_FIELD_IDS.VEHICLE_MAKE, operator: 'equals', value: 'Ford' } }
                : field
        ));
        const changedTypeFields = preset.formFields.map(field => (
            field.id === PARKING_FIELD_IDS.LICENSE_PLATE
                ? { ...field, type: 'textarea' }
                : field
        ));
        const missingLicensePlateError = ['Missing required parking field: License Plate.'];
        expect(validateParkingEventDraft({
            ...preset,
            paymentEnabled: true,
            paymentAmount: '100',
            formFields: conditionalFields,
        })).toEqual(missingLicensePlateError);
        expect(validateParkingEventDraft({
            ...preset,
            paymentEnabled: true,
            paymentAmount: '100',
            formFields: changedTypeFields,
        })).toEqual(missingLicensePlateError);

        expect(validateParkingEventDraft(createEventPreset(EVENT_TYPES.STANDARD))).toEqual([]);
        expect(validateParkingEventRecord({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            form_fields: preset.formFields,
            waivers: preset.waivers,
        })).toEqual([]);
        expect(validateParkingEventRecord({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            form_fields: weakenedFields,
            waivers: preset.waivers,
        })).toEqual(['Missing required parking field: License Plate.']);
        expect(validateParkingEventRecord({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            form_fields: conditionalFields,
            waivers: preset.waivers,
        })).toEqual(missingLicensePlateError);
        expect(validateParkingEventRecord({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            form_fields: changedTypeFields,
            waivers: preset.waivers,
        })).toEqual(missingLicensePlateError);
    });
});
