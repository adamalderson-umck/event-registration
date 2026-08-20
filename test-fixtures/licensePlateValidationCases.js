export const VALID_LICENSE_PLATE_CASES = Object.freeze([
  ['abc 123', 'ABC123'],
  ['abc-123', 'ABC123'],
  ['  kdm482  ', 'KDM482'],
  ['outatime', 'OUTATIME'],
  ['8042', '8042'],
  ['bird', 'BIRD'],
  ['t-e-m-p', 'TEMP'],
]);

export const INVALID_LICENSE_PLATE_CASES = Object.freeze([
  '', 'X', 'AB', 'ABCDEFGHI', 'ABC@123', 'ÅBC123',
  'XXX', 'AAAAAA', '111111',
  'TEST', 'TESTING', 'NONE', 'UNKNOWN', 'NOPLATE', 'NIL', 'NULL', 'PLATE', 'LICENSE',
  'ABC', 'ABCDEF', 'FEDCBA', '123', '123456', '654321',
  'QWE', 'QWERTY', 'ASDFGH', 'HGFDSA', 'ZXCVBN', 'NBVCXZ',
]);
