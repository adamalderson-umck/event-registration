import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    printEventSummary,
    printIndividualRegistration,
    printRegistrationTable,
} from '../printReports';

describe('printRegistrationTable', () => {
    let write;

    beforeEach(() => {
        vi.useFakeTimers();
        write = vi.fn();
        vi.spyOn(window, 'open').mockReturnValue({
            document: {
                write,
                close: vi.fn(),
            },
            focus: vi.fn(),
            print: vi.fn(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('prints parking fields with report parity columns', () => {
        const event = {
            title: 'Parking Event',
            form_fields: [
                { id: 'system_first_name', label: 'First Name', type: 'text' },
                { id: 'parking_license_plate', label: 'License Plate', type: 'text' },
            ],
            waivers: [],
        };
        const registrations = [
            {
                id: 'registration-1',
                status: 'confirmed',
                payment_status: 'paid',
                payment_expected_amount: 50,
                payment_recorded_total: 65,
                created_at: '2026-08-04T12:00:00Z',
                form_data: {
                    system_first_name: 'Alex',
                    parking_license_plate: 'ABC123',
                },
                signature_records: [],
            },
            {
                id: 'registration-2',
                status: 'confirmed',
                payment_status: 'partial',
                payment_expected_amount: 50,
                payment_recorded_total: 25,
                form_data: {
                    system_first_name: 'Jordan',
                    parking_license_plate: 'XYZ789',
                },
                signature_records: [],
            },
        ];

        printRegistrationTable(registrations, event);

        const html = write.mock.calls[0][0];
        expect(html).toContain('<th>License Plate</th>');
        expect(html).toContain('<th>Status</th><th>Payment</th><th>Submitted</th>');
        expect(html).toContain('<td>ABC123</td>');
        expect(html).toContain('<td>confirmed</td><td>Paid — $65.00 recorded</td>');
        expect(html).toContain('<td>Partially Paid — $25.00 of $50.00</td>');
        expect(html).toContain(new Date('2026-08-04T12:00:00Z').toLocaleString());
    });

    it('prints one parking registration as a portrait, sectioned two-column document', () => {
        printIndividualRegistration({
            status: 'confirmed',
            payment_status: 'paid',
            payment_expected_amount: 100,
            payment_recorded_total: 100,
            created_at: '2026-08-11T17:16:39Z',
            form_data: {
                system_first_name: 'Alex',
                system_last_name: 'Morgan',
                system_email: 'alex@example.org',
                parking_phone: '(330) 555-0100',
                parking_local_street: '123 Main Street',
                parking_vehicle_make: 'Honda',
            },
            registration_payments: [],
        }, {
            title: 'Student Parking - Fall 2026',
            event_type: 'parking',
            form_fields: [
                { id: 'system_first_name', label: 'Your First Name', type: 'text' },
                { id: 'system_last_name', label: 'Your Last Name', type: 'text' },
                { id: 'system_email', label: 'Your Email', type: 'email' },
                { id: 'parking_phone', label: 'Phone Number', type: 'phone' },
                { id: 'parking_local_street', label: 'Local Street Address', type: 'text' },
                { id: 'parking_vehicle_make', label: 'Vehicle Make', type: 'text' },
            ],
        });

        const html = write.mock.calls[0][0];
        expect(html).toContain('@page { size: letter portrait;');
        expect(html).toContain('class="field-grid"');
        expect(html).toContain('<h2 class="section-title">Registrant</h2>');
        expect(html).toContain('<h2 class="section-title">Local Address</h2>');
        expect(html).toContain('<h2 class="section-title">Vehicle</h2>');
        expect(html).toContain('class="address-sections"');
        expect(html).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
        expect(html).toContain('break-inside: avoid');
    });

    it('prints an escaped payment summary and audit history for one registration', () => {
        printIndividualRegistration({
            payment_status: 'partial',
            payment_expected_amount: 50,
            payment_recorded_total: 25,
            registration_payments: [{
                id: 'p1',
                method: 'check',
                amount: 25,
                payment_date: '2026-08-04',
                reference_number: '10<&42',
                created_at: '2026-08-05T12:00:00Z',
                created_by: 'admin-1',
            }],
        }, { title: 'Parking Event', form_fields: [] });

        const html = write.mock.calls[0][0];
        expect(html).toContain('Partially Paid — $25.00 of $50.00');
        expect(html).toContain('Check #10&lt;&amp;42');
        expect(html).toContain('$25.00');
    });

    it('sums recorded totals instead of multiplying paid registrations by the event amount', () => {
        printEventSummary([
            { status: 'confirmed', payment_status: 'paid', payment_recorded_total: 65 },
            { status: 'confirmed', payment_status: 'partial', payment_recorded_total: 25 },
            { status: 'cancelled', payment_status: 'paid', payment_recorded_total: 10 },
        ], { title: 'Donation Event', payment_enabled: true, payment_amount: 50 });

        const html = write.mock.calls[0][0];
        expect(html).toContain('Payment Collected');
        expect(html).toContain('$100.00');
        expect(html).toContain('Partially Paid');
    });
});
