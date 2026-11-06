const text = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const positionText = value => text(value).replace(/[\s/]+/g, '');
const unique = values => [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es', {numeric:true}));

export function tableRow(row) {
  const original = unique(row.oldDetails.map(detail => detail.position));
  return {
    ...row,
    originalLocations: original.length ? original : unique(row.oldPositions),
    loadedLocations: unique(row.wmsDetails.map(detail => detail.position))
  };
}

export function numberMatches(value, filter) {
  if (!filter.trim()) return true;
  if (value === null || value === undefined) return false;
  const match = filter.trim().match(/^(>=|<=|!=|<>|>|<|=)?\s*(-?[\d.,]+)$/);
  if (!match) return false;
  let number = match[2];
  if (number.includes(',')) number = number.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(number)) number = number.replace(/\./g, '');
  const expected = Number(number);
  if (!Number.isFinite(expected)) return false;
  switch (match[1]) {
    case '>': return value > expected;
    case '<': return value < expected;
    case '>=': return value >= expected;
    case '<=': return value <= expected;
    case '!=': case '<>': return value !== expected;
    default: return value === expected;
  }
}

export function columnMatches(row, filters) {
  const contains = (value, filter) => !filter || text(value).includes(text(filter));
  const positionMatches = (values, filter) => !filter || values.some(value => positionText(value).includes(positionText(filter)));
  return positionMatches(row.originalLocations, filters.original || '') &&
    positionMatches(row.loadedLocations, filters.loaded || '') &&
    contains(row.sku + ' ' + row.description, filters.article) &&
    numberMatches(row.saleUnit, filters.saleUnit || '') &&
    numberMatches(row.oldPresent ? row.oldQty : null, filters.oldQty || '') &&
    numberMatches(row.wmsPresent ? row.wmsQty : null, filters.wmsQty || '') &&
    numberMatches(row.delta, filters.delta || '') &&
    (!filters.kind || row.kind === filters.kind) &&
    (!filters.status || row.status === filters.status);
}
