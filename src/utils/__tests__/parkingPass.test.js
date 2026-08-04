import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import { buildParkingPassHtml, printParkingPass } from '../parkingPass';

const event = {
    title: 'Fall 2026 Parking',
    start_date: '2026-08-15T09:00:00-04:00',
    end_date: '2026-12-15T17:00:00-05:00',
};

function registration(overrides = {}) {
    return {
        id: 'abc12345-long-reference',
        status: 'confirmed',
        payment_status: 'paid',
        email: 'driver@example.com',
        form_data: {
            [PARKING_FIELD_IDS.LOCAL_STREET]: '123 Private Drive',
            [PARKING_FIELD_IDS.INSURANCE_PROVIDER]: 'Private Insurance Co.',
            [PARKING_FIELD_IDS.VEHICLE_YEAR]: '2024',
            [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
            [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
            [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
            [PARKING_FIELD_IDS.LICENSE_PLATE]: '<ABC&123>',
        },
        ...overrides,
    };
}

describe('parking passes', () => {
    afterEach(() => vi.restoreAllMocks());

    it('builds a printable pass with only the approved information', () => {
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' });

        expect(html).toContain('@page { size: 2.833in 11in; margin: 0; }');
        expect(html).toContain('&lt;ABC&amp;123&gt;');
        expect(html).toContain('2024 Blue Honda Civic');
        expect(html).toContain('VALID PARKING PASS');
        expect(html).toContain('abc12345');
        expect(html).toContain('Aug 15, 2026 - Dec 15, 2026');
        expect(html).toContain('Display this pass');
        expect(html).not.toContain('driver@example.com');
        expect(html).not.toContain('123 Private Drive');
        expect(html).not.toContain('Private Insurance Co.');
    });

    it('does not open a window for a registration that cannot print a pass', () => {
        const open = vi.spyOn(window, 'open');

        expect(() => printParkingPass(registration({ payment_status: 'pending' }), event, 'Kent Methodist Church'))
            .toThrow('Only valid parking registrations can be printed.');
        expect(open).not.toHaveBeenCalled();
    });

    it('requires a license plate before building a pass', () => {
        const incomplete = registration({
            form_data: {
                ...registration().form_data,
                [PARKING_FIELD_IDS.LICENSE_PLATE]: '',
            },
        });

        expect(() => buildParkingPassHtml(incomplete, event, 'Kent Methodist Church'))
            .toThrow('Required parking pass values are missing.');
    });
});
