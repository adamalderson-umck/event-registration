import { describe, it, expect } from 'vitest';
import { evaluateCondition, splitIntoPages } from '../formConditions';

describe('evaluateCondition', () => {
  it('returns true when condition is null/undefined', () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition(undefined, {})).toBe(true);
  });

  it('equals — string match', () => {
    const cond = { field: 'f1', operator: 'equals', value: 'Yes' };
    expect(evaluateCondition(cond, { f1: 'Yes' })).toBe(true);
    expect(evaluateCondition(cond, { f1: 'No' })).toBe(false);
  });

  it('equals — coerces numbers to string', () => {
    const cond = { field: 'f1', operator: 'equals', value: '3' };
    expect(evaluateCondition(cond, { f1: 3 })).toBe(true);
  });

  it('equals — array value (checkboxGroup)', () => {
    const cond = { field: 'f1', operator: 'equals', value: 'Nuts' };
    expect(evaluateCondition(cond, { f1: ['Nuts', 'Dairy'] })).toBe(true);
    expect(evaluateCondition(cond, { f1: ['Dairy'] })).toBe(false);
  });

  it('notEquals — string mismatch', () => {
    const cond = { field: 'f1', operator: 'notEquals', value: 'No' };
    expect(evaluateCondition(cond, { f1: 'Yes' })).toBe(true);
    expect(evaluateCondition(cond, { f1: 'No' })).toBe(false);
  });

  it('notEquals — array value', () => {
    const cond = { field: 'f1', operator: 'notEquals', value: 'Nuts' };
    expect(evaluateCondition(cond, { f1: ['Dairy'] })).toBe(true);
    expect(evaluateCondition(cond, { f1: ['Nuts', 'Dairy'] })).toBe(false);
  });

  it('treats missing source field (undefined) as an empty string', () => {
    // If field is undefined, it is treated as ""
    const equalsCond = { field: 'missing', operator: 'equals', value: 'X' };
    expect(evaluateCondition(equalsCond, {})).toBe(false); // "" === "X" => false

    const notEqualsCond = { field: 'missing', operator: 'notEquals', value: 'X' };
    expect(evaluateCondition(notEqualsCond, {})).toBe(true); // "" !== "X" => true
  });

  it('returns true for unknown operator', () => {
    const cond = { field: 'f1', operator: 'startsWith', value: 'A' };
    expect(evaluateCondition(cond, { f1: 'Apple' })).toBe(true);
  });
});

describe('splitIntoPages', () => {
  it('returns single page when no section breaks', () => {
    const fields = [
      { id: 'f1', type: 'text', label: 'Name' },
      { id: 'f2', type: 'email', label: 'Email' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(1);
    expect(pages[0].fields).toHaveLength(2);
    expect(pages[0].title).toBeNull();
  });

  it('splits on sectionBreak items', () => {
    const fields = [
      { id: 'sec_1', type: 'sectionBreak', label: 'Personal' },
      { id: 'f1', type: 'text', label: 'Name' },
      { id: 'sec_2', type: 'sectionBreak', label: 'Medical' },
      { id: 'f2', type: 'textarea', label: 'Allergies' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBe('Personal');
    expect(pages[0].fields).toHaveLength(1);
    expect(pages[1].title).toBe('Medical');
    expect(pages[1].fields).toHaveLength(1);
  });

  it('handles fields before the first section break', () => {
    const fields = [
      { id: 'f0', type: 'text', label: 'Intro' },
      { id: 'sec_1', type: 'sectionBreak', label: 'Page Two' },
      { id: 'f1', type: 'text', label: 'Detail' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBeNull();
    expect(pages[0].fields).toHaveLength(1);
    expect(pages[1].title).toBe('Page Two');
  });

  it('skips empty sections', () => {
    const fields = [
      { id: 'sec_1', type: 'sectionBreak', label: 'Empty' },
      { id: 'sec_2', type: 'sectionBreak', label: 'Has Fields' },
      { id: 'f1', type: 'text', label: 'Name' },
    ];
    const pages = splitIntoPages(fields);
    expect(pages).toHaveLength(2);
    expect(pages[0].fields).toHaveLength(0);
    expect(pages[1].fields).toHaveLength(1);
  });

  it('returns empty single page for empty field array', () => {
    const pages = splitIntoPages([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].fields).toHaveLength(0);
  });
});
