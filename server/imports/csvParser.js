// Parse CSV content into rows, handling multi-line quoted fields (RFC 4180 compliant)
export function parseCSV(csvContent) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote - add single quote and skip next
        currentField += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field delimiter
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\r' && nextChar === '\n' && !inQuotes) {
      // Windows line ending - row delimiter (only when not in quotes)
      i++; // Skip \n
      currentRow.push(currentField.trim());
      if (currentRow.some(field => field !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // Unix line ending or standalone \r - row delimiter (only when not in quotes)
      currentRow.push(currentField.trim());
      if (currentRow.some(field => field !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Handle last field/row
  currentRow.push(currentField.trim());
  if (currentRow.some(field => field !== '')) {
    rows.push(currentRow);
  }

  return rows;
}

// Parse CSV content and convert to array of objects using first row as headers
export function parseCSVToObjects(csvContent) {
  const rows = parseCSV(csvContent);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = rows[i][j] || '';
    }
    result.push(row);
  }

  return result;
}
