import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printIndividualRegistration, printRegistrationTable } from '../printReports';

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
                payment_status: 'paid & <review>',
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
        expect(html).toContain('<td>confirmed</td><td>paid</td>');
        expect(html).toContain('<td>paid &amp; &lt;review&gt;</td>');
        expect(html).toContain(new Date('2026-08-04T12:00:00Z').toLocaleString());
    });

    it('escapes payment status in an individual registration report', () => {
        printIndividualRegistration(
            { payment_status: 'paid & <review>' },
            { title: 'Parking Event', form_fields: [] }
        );

        const html = write.mock.calls[0][0];
        expect(html).toContain('Payment: <strong>paid &amp; &lt;review&gt;</strong>');
    });
});
