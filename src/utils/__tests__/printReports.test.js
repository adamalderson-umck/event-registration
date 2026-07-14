import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printRegistrationTable } from '../printReports';

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

    it('prints Waiver and Media after form fields and before Status', () => {
        const event = {
            title: 'Beta Event',
            form_fields: [
                { id: 'name', label: 'Name', type: 'text' },
                { id: 'section', label: 'Details', type: 'sectionBreak' },
            ],
            waivers: [
                { id: 'liability', title: 'Liability Waiver', required: true },
                { id: 'media', title: 'Media Release', required: false },
            ],
        };
        const registrations = [{
            id: 'registration-1',
            status: 'confirmed',
            form_data: { name: 'Alex' },
            signature_records: [
                { waiverId: 'liability', signed: true, declined: false },
                { waiverId: 'media', signed: false, declined: true },
            ],
        }];

        printRegistrationTable(registrations, event);

        const html = write.mock.calls[0][0];
        expect(html).toContain(
            '<thead><tr><th>Name</th><th>Waiver</th><th>Media</th><th>Status</th></tr></thead>'
        );
        expect(html).toContain(
            '<tr><td>Alex</td><td>Signed</td><td>Declined</td><td>confirmed</td></tr>'
        );
    });
});
