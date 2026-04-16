/**
 * Evaluates whether a field's condition is satisfied by the current form data.
 * Returns true (visible) when:
 *   - condition is null/undefined (unconditional field)
 *   - the referenced field doesn't exist in formData (deleted-ref fallback)
 *   - the operator is unrecognized (forward compatibility)
 *
 * @param {Object|null} condition  — { field, operator, value }
 * @param {Object}      formData  — { [fieldId]: value }
 * @returns {boolean}
 */
export function evaluateCondition(condition, formData) {
  if (!condition) return true;

  const actualValue = formData[condition.field];

  switch (condition.operator) {
    case 'equals':
      if (Array.isArray(actualValue)) return actualValue.includes(condition.value);
      return String(actualValue || '') === String(condition.value);
    case 'notEquals':
      if (Array.isArray(actualValue)) return !actualValue.includes(condition.value);
      return String(actualValue || '') !== String(condition.value);
    default:
      return true;
  }
}

/**
 * Splits a flat form_fields array into pages at sectionBreak items.
 * Each page is { title: string|null, fields: Field[] }.
 * Section breaks themselves are NOT included in the fields arrays.
 *
 * @param {Array} fields — the raw form_fields array from the event
 * @returns {{ title: string|null, fields: Object[] }[]}
 */
export function splitIntoPages(fields) {
  if (!fields || fields.length === 0) {
    return [{ title: null, fields: [] }];
  }

  const pages = [];
  let currentPage = { title: null, fields: [] };

  for (const field of fields) {
    if (field.type === 'sectionBreak') {
      // Push the accumulated page before starting a new one
      if (pages.length > 0 || currentPage.fields.length > 0 || currentPage.title !== null) {
        pages.push(currentPage);
      }
      currentPage = { title: field.label || null, fields: [] };
    } else {
      currentPage.fields.push(field);
    }
  }

  // Push the last page
  pages.push(currentPage);

  return pages;
}
