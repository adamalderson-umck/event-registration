import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import { buildParkingPassHtml, printParkingPass } from '../parkingPass';

const event = {
    title: 'Fall 2026 Parking',
    start_date: '2026-08-15T09:00:00-04:00',
    end_date: '2026-12-15T17:00:00-05:00',
};

const assets = { logoUrl: '/assets/UMC_of_Kent_logo.svg', fontUrl: '/assets/source-sans-3-latin-wght-normal.woff2' };

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

    it('builds the approved rotated monument document with only approved information', () => {
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' }, assets);

        expect(html).toContain('Kent Methodist Church');
        expect(html).toContain('Fall 2026 Parking');
        expect(html).toContain('&lt;ABC&amp;123&gt;');
        expect(html).toContain('2024 Blue Honda Civic');
        expect(html).toContain('VALID PARKING PASS');
        expect(html).toContain('Parking permitted in designated areas only.');
        expect(html).toContain('abc12345');
        expect(html).toContain('Aug 15, 2026 - Dec 15, 2026');
        expect(html).toContain('Display this pass clearly in your vehicle.');
        expect(html).not.toContain('driver@example.com');
        expect(html).not.toContain('123 Private Drive');
        expect(html).not.toContain('Private Insurance Co.');
        expect(html.indexOf('2024 Blue Honda Civic')).toBeLessThan(html.indexOf('Parking permitted in designated areas only.'));
        expect(html.indexOf('Parking permitted in designated areas only.')).toBeLessThan(html.indexOf('<footer class="pass-footer">'));
    });

    it('uses a rotated logical artwork area in the top third of a portrait Letter sheet', () => {
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' }, assets);

        expect(html).toContain('@page { size: letter portrait; margin: 0; }');
        expect(html).toContain('html, body { width: 8.5in; height: 11in; margin: 0; overflow: hidden; }');
        expect(html).toContain('.pass { position: relative; width: 8.5in; height: 3.66in; overflow: hidden; }');
        expect(html).toContain('.pass-artwork { position: absolute; top: 0; left: 0; width: 3.66in; height: 8.5in; overflow: hidden; transform: translateX(8.5in) rotate(90deg); transform-origin: top left;');
        expect(html).not.toContain('overflow: auto');
        expect(html).not.toContain('overflow: scroll');
    });

    it('embeds the approved font and logo treatment', () => {
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' }, {
            ...assets,
            fontUrl: '/assets/source-sans-3-latin-wght-normal.woff2?cache=a&v=1',
        });

        expect(html).toContain("@font-face { font-family: 'Source Sans 3'; src: url('/assets/source-sans-3-latin-wght-normal.woff2?cache=a&v=1') format('woff2'); font-style: normal; font-weight: 200 900; font-display: swap; }");
        expect(html).toContain(".plate { font-size: 42pt; line-height: .95; font-weight: 900;");
        expect(html).toContain(".valid { background: #111; color: #fff; font-size: 13pt; font-weight: 900;");
        expect(html).toContain(".organization { font-size: 11pt; font-weight: 700;");
        expect(html).toContain(".event { font-size: 10pt; font-weight: 800;");
        expect(html).toContain(".vehicle { font-size: 11pt; font-weight: 700;");
        expect(html).toContain(".advisory { border-top: 1px solid #aaa; border-bottom: 1px solid #aaa; color: #777; font-size: 10pt; font-weight: 800;");
        expect(html).toContain(".meta-label { color: #777; font-size: 7pt; font-weight: 700;");
        expect(html).toContain(".meta-value { font-size: 9pt; font-weight: 700;");
        expect(html).toContain(".direction { text-align: center; font-size: 8pt; font-weight: 600;");
        expect(html.match(/\/assets\/UMC_of_Kent_logo\.svg/g)).toHaveLength(2);
        expect(html).toContain('<img class="brand-logo" src="/assets/UMC_of_Kent_logo.svg" alt="Kent Methodist Church logo">');
        expect(html).toContain('<img class="watermark" src="/assets/UMC_of_Kent_logo.svg" alt="" aria-hidden="true">');
        expect(html).toContain('.brand-logo { width: .54in; height: .54in; object-fit: contain; filter: grayscale(1) brightness(0); }');
        expect(html).toContain('.watermark { position: absolute; width: 6.6in; height: 6.6in;');
        expect(html).toContain('filter: grayscale(1) brightness(0); opacity: .045;');
        expect(html).toContain('opacity: .045;');
    });

    it('serializes hostile font URLs as one safe CSS string value', () => {
        const fontUrl = "/assets/font.woff2?cache=a&v=1');}.injected{color:red}</style><img src=x onerror=alert(1)>/*";
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' }, {
            ...assets,
            fontUrl,
        });

        expect(html).toContain("src: url('/assets/font.woff2?cache=a&v=1\\');}.injected{color:red}\\3c /style>\\3c img src=x onerror=alert(1)>/*') format('woff2');");
        expect(html).toMatch(/src: url\('(?:[^'\\]|\\.)*'\) format\('woff2'\);/);
        expect(html).not.toContain("');}.injected{color:red}</style><img src=x onerror=alert(1)>");
    });

    it('serializes control characters in font URLs as terminated CSS hex escapes', () => {
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' }, {
            ...assets,
            fontUrl: '/assets/font.woff2?marker=\u0001&v=1',
        });

        expect(html).toContain("src: url('/assets/font.woff2?marker=\\1 &v=1') format('woff2');");
    });

    it('keeps hostile logo URLs inside escaped image attributes', () => {
        const html = buildParkingPassHtml(registration(), event, { name: 'Kent Methodist Church' }, {
            ...assets,
            logoUrl: '/assets/logo.svg"><img src=x onerror=alert(1)>',
        });

        expect(html).toContain('<img class="brand-logo" src="/assets/logo.svg&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" alt="Kent Methodist Church logo">');
        expect(html).not.toContain('src="/assets/logo.svg"><img src=x onerror=alert(1)>');
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
