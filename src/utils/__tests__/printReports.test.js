import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    printEventSummary,
    printIndividualRegistration,
    printRegistrationTable,
    printSignInSheet,
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

    const parkingEvent = {
        title: 'Parking <Fall>', event_type: 'parking', payment_enabled: true,
        form_fields: [{ id: 'name', label: 'Name <registrant>', type: 'text' }],
        waivers: [
            { id: 'liability', required: true },
            { id: 'media', title: 'Media Release', required: false },
        ],
    };
    const finalizedRegistration = {
        id: 'registration-123', status: 'confirmed', payment_status: 'paid',
        payment_method: 'in_person', payment_expected_amount: 50, payment_recorded_total: 65,
        form_data: JSON.stringify({ name: 'Alex <Morgan>' }),
        parking_pass_finalized_at: '2026-08-26T12:00:00Z',
        parking_pass_finalized_by_name: 'Pat <Admin>',
        signature_records: [
            { waiverId: 'liability', signed: true },
            { waiverId: 'media', declined: true },
        ],
    };

    it.each([
        ['table', (registration, event) => printRegistrationTable([registration], event)],
        ['individual', printIndividualRegistration],
    ])('prints pass finalization details in the %s report', (_name, print) => {
        print(finalizedRegistration, parkingEvent);
        const doc = new DOMParser().parseFromString(write.mock.calls[0][0], 'text/html');
        expect(doc.body.textContent).toContain('Pass Status');
        expect(doc.body.textContent).toContain('Finalized');
        expect(doc.body.textContent).toContain('Pat <Admin>');
        expect(doc.body.textContent).toContain(new Date('2026-08-26T12:00:00Z').toLocaleString());
        expect(doc.body.textContent).toContain('Alex <Morgan>');
        expect(doc.body.textContent).toContain('Signed');
        expect(doc.body.textContent).toContain('Declined');
        expect(doc.querySelector('admin')).toBeNull();
        expect(doc.querySelector('registrant')).toBeNull();
    });

    it('includes registration identity and payment context in individual details', () => {
        printIndividualRegistration(finalizedRegistration, parkingEvent);
        const text = new DOMParser().parseFromString(write.mock.calls[0][0], 'text/html').body.textContent;
        for (const value of ['Registration ID', 'registration-123', 'Selected Payment Method', 'in_person', 'Expected Amount', '$50.00']) {
            expect(text).toContain(value);
        }
    });

    it('splits wide reports into printable tables without losing columns or row identity', () => {
        const fields = Array.from({ length: 12 }, (_, index) => ({ id: `f${index}`, label: `Field ${index}`, type: 'text' }));
        printRegistrationTable([
            { ...finalizedRegistration, form_data: Object.fromEntries(fields.map(field => [field.id, `Answer ${field.id}`])) },
            { status: 'waitlisted', form_data: {} },
        ], { ...parkingEvent, form_fields: fields });
        const doc = new DOMParser().parseFromString(write.mock.calls[0][0], 'text/html');
        const tables = [...doc.querySelectorAll('table')];
        expect(tables.length).toBeGreaterThan(1);
        const labels = tables.flatMap(table => [...table.querySelectorAll('th')].slice(1).map(cell => cell.textContent));
        expect(labels).toEqual([...fields.map(field => field.label), 'Waiver', 'Media', 'Status', 'Payment', 'Submitted', 'Pass Status', 'Pass Finalized At', 'Pass Finalized By']);
        for (const table of tables) {
            expect(table.querySelectorAll('th').length).toBeLessThanOrEqual(9);
            expect([...table.querySelectorAll('tbody tr')].map(row => row.cells[0].textContent)).toEqual(['1', '2']);
        }
        for (const field of fields) expect(doc.body.textContent).toContain(`Answer ${field.id}`);
    });

    it('distinguishes waitlisted attendees and parking eligibility on sign-in sheets', () => {
        printSignInSheet([
            finalizedRegistration,
            { status: 'waitlisted', form_data: { name: 'Waiting' } },
            { status: 'cancelled', form_data: { name: 'Cancelled person' } },
        ], parkingEvent);
        const doc = new DOMParser().parseFromString(write.mock.calls[0][0], 'text/html');
        const headers = [...doc.querySelectorAll('th')].map(cell => cell.textContent);
        expect(headers).toEqual(['Name <registrant>', 'Status', 'Pass Status', 'Signature / Check-In']);
        const rows = [...doc.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent));
        expect(rows[0]).toEqual(['Alex <Morgan>', 'confirmed', 'Finalized', '']);
        expect(rows[1]).toEqual(['Waiting', 'waitlisted', 'Waitlisted', '']);
        expect(rows).toHaveLength(7);
        expect(rows.every(row => row.length === headers.length)).toBe(true);
        expect(doc.body.textContent).not.toContain('Cancelled person');
    });

    it('summarizes every parking pass state and waiver/media decisions', () => {
        printEventSummary([
            finalizedRegistration,
            { status: 'confirmed', payment_status: 'paid' },
            { status: 'confirmed', payment_status: 'pending' },
            { status: 'confirmed', payment_status: 'partial' },
            { status: 'waitlisted', payment_status: 'not_required' },
            { status: 'cancelled' },
        ], parkingEvent);
        const doc = new DOMParser().parseFromString(write.mock.calls[0][0], 'text/html');
        const sections = [...doc.querySelectorAll('section')];
        const passSection = sections.find(section => section.textContent.includes('Pass Status'));
        expect(passSection).toBeDefined();
        const counts = Object.fromEntries([...passSection.querySelectorAll('.summary-box')].map(box => [
            box.querySelector('.label').textContent, box.querySelector('.value').textContent,
        ]));
        expect(counts).toEqual({ Finalized: '1', Valid: '1', 'Payment pending': '2', Waitlisted: '1', Invalid: '1' });
        expect(doc.body.textContent).toContain('Waiver Signed');
        expect(doc.body.textContent).toContain('Media Declined');
    });

    it.each([
        ['table', event => printRegistrationTable([finalizedRegistration], event)],
        ['individual', event => printIndividualRegistration(finalizedRegistration, event)],
        ['sign-in', event => printSignInSheet([finalizedRegistration], event)],
        ['summary', event => printEventSummary([finalizedRegistration], event)],
    ])('omits parking-only information from the non-parking %s report', (_name, print) => {
        print({ ...parkingEvent, event_type: 'general' });
        expect(write.mock.calls[0][0]).not.toContain('Pass Status');
        expect(write.mock.calls[0][0]).not.toContain('Pass Finalized');
    });
});
