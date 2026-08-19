import { describe, expect, it } from 'vitest';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import {
    PARKING_PASS_STATUS,
    canFinalizeParkingPass,
    canPrintParkingPass,
    canUndoParkingPassFinalization,
    getParkingFieldValue,
    getParkingPassStatus,
    getParkingVehicleLabel,
} from '../parkingRegistration';

function registration(overrides = {}) {
    return {
        status: 'confirmed',
        payment_status: 'paid',
        form_data: {
            [PARKING_FIELD_IDS.VEHICLE_YEAR]: '2024',
            [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
            [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
            [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
            [PARKING_FIELD_IDS.LICENSE_PLATE]: 'ABC 123',
        },
        ...overrides,
    };
}

describe('parking registration helpers', () => {
    it('returns trimmed parking field values', () => {
        expect(getParkingFieldValue(registration(), PARKING_FIELD_IDS.LICENSE_PLATE)).toBe('ABC 123');
    });

    it('builds the parking vehicle label in year, color, make, model order', () => {
        expect(getParkingVehicleLabel(registration())).toBe('2024 Blue Honda Civic');
    });

    it.each([
        ['confirmed', 'paid', PARKING_PASS_STATUS.VALID],
        ['confirmed', 'pending', PARKING_PASS_STATUS.PAYMENT_PENDING],
        ['confirmed', 'partial', PARKING_PASS_STATUS.PAYMENT_PENDING],
        ['confirmed', 'failed', PARKING_PASS_STATUS.INVALID],
        ['waitlisted', 'paid', PARKING_PASS_STATUS.WAITLISTED],
        ['waitlisted', 'pending', PARKING_PASS_STATUS.WAITLISTED],
        ['cancelled', 'paid', PARKING_PASS_STATUS.INVALID],
        ['pending', 'paid', PARKING_PASS_STATUS.INVALID],
    ])('maps %s registration with %s payment to %s', (status, paymentStatus, expected) => {
        expect(getParkingPassStatus(registration({ status, payment_status: paymentStatus }))).toBe(expected);
    });

    it('allows printing only valid parking passes', () => {
        expect(canPrintParkingPass(registration())).toBe(true);
        expect(canPrintParkingPass(registration({ payment_status: 'pending' }))).toBe(false);
        expect(canPrintParkingPass(registration({ payment_status: 'partial' }))).toBe(false);
    });

    it('shows Finalized independently of later registration status', () => {
        const finalized = {
            parking_pass_finalized_at: '2026-08-19T14:30:00Z',
            parking_pass_finalized_by_name: 'Admin User',
        };
        expect(getParkingPassStatus(registration(finalized))).toBe(PARKING_PASS_STATUS.FINALIZED);
        expect(getParkingPassStatus(registration({ ...finalized, status: 'cancelled' })))
            .toBe(PARKING_PASS_STATUS.FINALIZED);
    });

    it('allows finalization and printing only for unfinalized valid passes', () => {
        const valid = registration();
        const finalized = registration({ parking_pass_finalized_at: '2026-08-19T14:30:00Z' });
        expect(canFinalizeParkingPass(valid)).toBe(true);
        expect(canPrintParkingPass(valid)).toBe(true);
        expect(canUndoParkingPassFinalization(valid)).toBe(false);
        expect(canFinalizeParkingPass(finalized)).toBe(false);
        expect(canPrintParkingPass(finalized)).toBe(false);
        expect(canUndoParkingPassFinalization(finalized)).toBe(true);
    });
});
