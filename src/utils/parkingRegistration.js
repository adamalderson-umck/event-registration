import { PARKING_FIELD_IDS } from '../config/eventPresets';

export const PARKING_PASS_STATUS = Object.freeze({
    VALID: 'Valid',
    PAYMENT_PENDING: 'Payment pending',
    WAITLISTED: 'Waitlisted',
    INVALID: 'Invalid',
});

export function getParkingFieldValue(registration, fieldId) {
    const value = registration?.form_data?.[fieldId];
    return value == null ? '' : String(value).trim();
}

export function getParkingVehicleLabel(registration) {
    return [
        PARKING_FIELD_IDS.VEHICLE_YEAR,
        PARKING_FIELD_IDS.VEHICLE_COLOR,
        PARKING_FIELD_IDS.VEHICLE_MAKE,
        PARKING_FIELD_IDS.VEHICLE_MODEL,
    ]
        .map(fieldId => getParkingFieldValue(registration, fieldId))
        .filter(Boolean)
        .join(' ');
}

export function getParkingPassStatus(registration) {
    if (registration?.status === 'waitlisted') {
        return PARKING_PASS_STATUS.WAITLISTED;
    }

    if (registration?.status !== 'confirmed') {
        return PARKING_PASS_STATUS.INVALID;
    }

    if (registration?.payment_status === 'paid') {
        return PARKING_PASS_STATUS.VALID;
    }

    if (registration?.payment_status === 'pending' || registration?.payment_status === 'partial') {
        return PARKING_PASS_STATUS.PAYMENT_PENDING;
    }

    return PARKING_PASS_STATUS.INVALID;
}

export function canPrintParkingPass(registration) {
    return getParkingPassStatus(registration) === PARKING_PASS_STATUS.VALID;
}
