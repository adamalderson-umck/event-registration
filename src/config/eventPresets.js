import { US_STATES } from './fieldTemplates';

export const EVENT_TYPES = Object.freeze({
    STANDARD: 'standard',
    PARKING: 'parking',
});

const freezeField = (field) => Object.freeze({
    ...field,
    ...(field.options ? { options: Object.freeze([...field.options]) } : {}),
});

export const SYSTEM_FIELDS = Object.freeze([
    { id: 'system_first_name', type: 'text', label: 'Your First Name', required: true, system: true },
    { id: 'system_last_name', type: 'text', label: 'Your Last Name', required: true, system: true },
    { id: 'system_email', type: 'email', label: 'Your Email', required: true, system: true },
].map(freezeField));

export const PARKING_FIELD_IDS = Object.freeze({
    PHONE: 'parking_phone',
    LOCAL_STREET: 'parking_local_street',
    LOCAL_CITY: 'parking_local_city',
    LOCAL_STATE: 'parking_local_state',
    LOCAL_ZIP: 'parking_local_zip',
    PERMANENT_STREET: 'parking_permanent_street',
    PERMANENT_CITY: 'parking_permanent_city',
    PERMANENT_STATE: 'parking_permanent_state',
    PERMANENT_ZIP: 'parking_permanent_zip',
    VEHICLE_YEAR: 'parking_vehicle_year',
    VEHICLE_MAKE: 'parking_vehicle_make',
    VEHICLE_MODEL: 'parking_vehicle_model',
    VEHICLE_COLOR: 'parking_vehicle_color',
    LICENSE_PLATE: 'parking_license_plate',
    REGISTRATION_STATE: 'parking_registration_state',
    REGISTRATION_COUNTY: 'parking_registration_county',
    INSURANCE_PROVIDER: 'parking_insurance_provider',
});

const protectedField = (id, type, label, required, options) => freezeField({
    id,
    type,
    label,
    required,
    system: true,
    placeholder: '',
    ...(options ? { options: [...options] } : {}),
});

export const PARKING_FIELDS = Object.freeze([
    protectedField(PARKING_FIELD_IDS.PHONE, 'phone', 'Phone Number', true),
    protectedField(PARKING_FIELD_IDS.LOCAL_STREET, 'text', 'Local Street Address', true),
    protectedField(PARKING_FIELD_IDS.LOCAL_CITY, 'text', 'Local City', true),
    protectedField(PARKING_FIELD_IDS.LOCAL_STATE, 'select', 'Local State', true, US_STATES),
    protectedField(PARKING_FIELD_IDS.LOCAL_ZIP, 'text', 'Local ZIP Code', true),
    protectedField(PARKING_FIELD_IDS.PERMANENT_STREET, 'text', 'Permanent Street Address', false),
    protectedField(PARKING_FIELD_IDS.PERMANENT_CITY, 'text', 'Permanent City', false),
    protectedField(PARKING_FIELD_IDS.PERMANENT_STATE, 'select', 'Permanent State', false, US_STATES),
    protectedField(PARKING_FIELD_IDS.PERMANENT_ZIP, 'text', 'Permanent ZIP Code', false),
    protectedField(PARKING_FIELD_IDS.VEHICLE_YEAR, 'number', 'Vehicle Year', false),
    protectedField(PARKING_FIELD_IDS.VEHICLE_MAKE, 'text', 'Vehicle Make', true),
    protectedField(PARKING_FIELD_IDS.VEHICLE_MODEL, 'text', 'Vehicle Model', true),
    protectedField(PARKING_FIELD_IDS.VEHICLE_COLOR, 'text', 'Vehicle Color', true),
    protectedField(PARKING_FIELD_IDS.LICENSE_PLATE, 'text', 'License Plate', true),
    protectedField(PARKING_FIELD_IDS.REGISTRATION_STATE, 'select', 'Vehicle Registration State', true, US_STATES),
    protectedField(PARKING_FIELD_IDS.REGISTRATION_COUNTY, 'text', 'Vehicle Registration County', true),
    protectedField(PARKING_FIELD_IDS.INSURANCE_PROVIDER, 'text', 'Insurance Provider', true),
]);

export const PARKING_RULES_HTML = `<ol><li>I understand that this parking pass is for the vehicle registered only and other vehicles must be registered.</li><li>I understand my vehicle must be removed from premises no later than Saturday evening and cannot be returned to the parking lot until 3:00 PM Sunday afternoon (violators will be towed).</li><li>I understand that parking at UMC of Kent is at my own risk and the church is not liable for any damage that may occur to my vehicle.</li><li>I understand that there will be no alcoholic beverages on the church premises.</li><li>I understand that the parking pass must be posted on the back window, driver's side, of my vehicle.</li><li>I understand this parking pass is for one semester only and a new pass must be obtained for each semester.</li><li>I understand parking is only permitted along the outside perimeter of the parking lot.</li><li>I understand that all donations made through the online giving portal are non-refundable.</li><li>I understand any violations will result in the loss of parking privileges with no refund.</li></ol>`;

const cloneField = (field) => ({
    ...field,
    ...(field.options ? { options: [...field.options] } : {}),
});

export const createEventPreset = (eventType = EVENT_TYPES.STANDARD) => {
    const isParking = eventType === EVENT_TYPES.PARKING;

    return {
        eventType: isParking ? EVENT_TYPES.PARKING : EVENT_TYPES.STANDARD,
        formFields: [
            ...SYSTEM_FIELDS,
            ...(isParking ? PARKING_FIELDS : []),
        ].map(cloneField),
        waivers: isParking ? [{
            id: 'parking_rules_agreement',
            title: 'Parking Rules and Agreement',
            content: PARKING_RULES_HTML,
            required: true,
            order: 0,
        }] : [],
        paymentEnabled: isParking,
        paymentAmount: '',
        allowInPersonPayment: isParking,
    };
};

export const validateParkingEventDraft = (event) => {
    if (event?.eventType !== EVENT_TYPES.PARKING) return [];

    const errors = [];
    if (!event.paymentEnabled || !(Number(event.paymentAmount) > 0)) {
        errors.push('Parking events require payment with a positive amount.');
    }

    PARKING_FIELDS.filter(field => field.required).forEach(field => {
        const candidate = event.formFields?.find(item => item.id === field.id);
        if (
            !candidate
            || candidate.system !== true
            || candidate.required !== true
            || candidate.type !== field.type
            || candidate.condition
        ) {
            errors.push(`Missing required parking field: ${field.label}.`);
        }
    });

    const parkingWaiver = event.waivers?.find(waiver => waiver.id === 'parking_rules_agreement');
    if (!parkingWaiver || parkingWaiver.required !== true) {
        errors.push('Parking events require the Parking Rules and Agreement waiver.');
    }

    return errors;
};

export const validateParkingEventRecord = (event) => validateParkingEventDraft({
    eventType: event?.event_type,
    paymentEnabled: event?.payment_enabled,
    paymentAmount: event?.payment_amount,
    formFields: event?.form_fields,
    waivers: event?.waivers,
});
