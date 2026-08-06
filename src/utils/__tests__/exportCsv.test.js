import { describe, it, expect } from 'vitest';
import { buildCsvString, buildPaymentLedgerCsv } from '../exportCsv';

describe('buildCsvString', () => {
  const fields = [
    { id: 'f1', label: 'First Name', type: 'text' },
    { id: 'f2', label: 'Email', type: 'email' },
    { id: 'f3', label: 'Allergies', type: 'checkboxGroup' },
  ];

  const waivers = [
    { id: 'liability', title: 'Liability Waiver', required: true },
    { id: 'media', title: 'Media Release', required: false },
  ];

  const registrations = [
    {
      id: 'r1', status: 'confirmed', payment_status: 'paid',
      payment_expected_amount: 50, payment_recorded_total: 65,
      created_at: '2026-03-20T12:00:00Z',
      form_data: { f1: 'Alice', f2: 'alice@test.com', f3: ['Peanuts', 'Gluten'] },
      signature_records: [
        { waiverId: 'liability', signed: true, declined: false },
        { waiverId: 'media', signed: false, declined: true },
      ],
    },
    {
      id: 'r2', status: 'waitlisted', payment_status: 'pending',
      payment_expected_amount: 50, payment_recorded_total: 0,
      created_at: '2026-03-21T08:30:00Z',
      form_data: { f1: 'Bob', f2: 'bob@test.com', f3: [] },
    },
  ];

  it('produces expected CSV header row', () => {
    const csv = buildCsvString(registrations, fields, waivers);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toBe('"First Name","Email","Allergies","Waiver","Media","Status","Payment","Submitted"');
  });

  it('produces expected data rows', () => {
    const csv = buildCsvString(registrations, fields, waivers);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('"Alice"');
    expect(lines[1]).toContain('"Signed","Declined","confirmed"');
    expect(lines[1]).toContain('"Peanuts, Gluten"');
    expect(lines[1]).toContain('"Paid — $65.00 recorded"');
  });

  it('escapes double quotes inside values', () => {
    const regs = [{
      id: 'r3', status: 'confirmed', payment_status: 'not_required',
      created_at: '2026-03-22T10:00:00Z',
      form_data: { f1: 'Said "Hi"', f2: 'x@y.com', f3: [] },
    }];
    const csv = buildCsvString(regs, fields);
    expect(csv).toContain('"Said ""Hi"""');
  });

  it('returns only header when registrations is empty', () => {
    const csv = buildCsvString([], fields);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('skips sectionBreak fields in output', () => {
    const fieldsWithBreak = [
      { id: 'sec_1', type: 'sectionBreak', label: 'Section 1' },
      { id: 'f1', label: 'First Name', type: 'text' },
      { id: 'sec_2', type: 'sectionBreak', label: 'Section 2' },
      { id: 'f2', label: 'Email', type: 'email' },
    ];
    const regs = [{
      id: 'r1', status: 'confirmed', payment_status: 'paid',
      created_at: '2026-03-20T12:00:00Z',
      form_data: { f1: 'Alice', f2: 'alice@test.com' },
    }];
    const csv = buildCsvString(regs, fieldsWithBreak);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).not.toContain('Section');
    expect(headerLine).toContain('First Name');
    expect(headerLine).toContain('Email');
  });

  it('preserves parking registration fields and report parity columns', () => {
    const parkingFields = [
      { id: 'system_first_name', label: 'First Name', type: 'text' },
      { id: 'parking_license_plate', label: 'License Plate', type: 'text' },
    ];
    const parkingRegistrations = [{
      id: 'parking-1',
      status: 'confirmed',
      payment_status: 'paid',
      payment_expected_amount: 50,
      payment_recorded_total: 65,
      form_data: {
        system_first_name: 'Alex',
        parking_license_plate: 'ABC123',
      },
      signature_records: [],
    }];

    const csv = buildCsvString(parkingRegistrations, parkingFields);
    const unquotedCsv = csv.replaceAll('"', '');

    expect(unquotedCsv).toContain(
      'First Name,License Plate,Waiver,Media,Status,Payment,Submitted'
    );
    expect(unquotedCsv).toContain(
      'Alex,ABC123,Missing,Missing,confirmed,Paid — $65.00 recorded'
    );
  });

  it('exports one ledger row per payment including void audit fields', () => {
    const registrationsWithPayments = [{
      ...registrations[0],
      registration_payments: [
        {
          id: 'p1', method: 'cash', amount: 25, payment_date: '2026-08-01',
          created_at: '2026-08-02T10:00:00Z', created_by: 'admin-1',
        },
        {
          id: 'p2', method: 'tithely', amount: 40, payment_date: '2026-08-02',
          reference_number: 'TX,"42"', created_at: '2026-08-02T11:00:00Z',
          created_by: 'admin-1', voided_at: '2026-08-03T11:00:00Z',
          voided_by: 'admin-2', void_reason: 'Wrong registration',
        },
      ],
    }];

    const csv = buildPaymentLedgerCsv(registrationsWithPayments, fields, { title: 'Beta Event' });
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Event","First Name","Email","Allergies","Registration ID"');
    expect(lines[1]).toContain('"Cash","25.00"');
    expect(lines[2]).toContain('"Tithe.ly","40.00","2026-08-02","TX,""42"""');
    expect(lines[2]).toContain(
      '"Voided","2026-08-03T11:00:00Z","admin-2","Wrong registration"'
    );
  });
});
