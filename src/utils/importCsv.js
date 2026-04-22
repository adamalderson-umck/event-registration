/**
 * A robust but lightweight CSV parser that handles quoted strings containing commas.
 */
export function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                // Escaped quote
                currentCell += '"';
                i++; // Skip the next quote
            } else {
                // Toggle quote state
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            // End of cell
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if (char === '\n' && !insideQuotes) {
            // End of row
            // Handle \r\n
            if (currentCell.endsWith('\r')) {
                currentCell = currentCell.slice(0, -1);
            }
            currentRow.push(currentCell.trim());
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else if (char === '\r' && nextChar === '\n' && !insideQuotes) {
            // Skip \r if it's followed by \n
        } else {
            currentCell += char;
        }
    }

    // Push the last cell and row if there's no trailing newline
    if (currentCell || currentRow.length > 0) {
        if (currentCell.endsWith('\r')) {
            currentCell = currentCell.slice(0, -1);
        }
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
    }

    return rows.filter(row => row.some(cell => cell.trim() !== '')); // Remove completely empty rows
}

function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function fuzzyMatchHeaders(csvHeaders, formFields) {
    const mappings = {}; // { csvHeaderIndex: formFieldId }
    
    // Create a normalized map of form fields for matching
    const normalizedFields = formFields.map(field => ({
        id: field.id,
        normalizedId: normalizeString(field.id),
        normalizedLabel: normalizeString(field.label)
    }));

    csvHeaders.forEach((header, index) => {
        const normHeader = normalizeString(header);
        if (!normHeader) return;
        
        // 1. Exact match on normalized ID
        let match = normalizedFields.find(f => f.normalizedId === normHeader);
        
        // 2. Exact match on normalized label
        if (!match) {
            match = normalizedFields.find(f => f.normalizedLabel === normHeader);
        }

        // 3. Substring match
        if (!match) {
            match = normalizedFields.find(f => 
                f.normalizedId.includes(normHeader) || 
                f.normalizedLabel.includes(normHeader) ||
                normHeader.includes(f.normalizedId) ||
                normHeader.includes(f.normalizedLabel)
            );
        }

        if (match) {
            mappings[index] = match.id;
        }
    });

    return mappings;
}

export async function processCsvFile(file, formFields) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const rows = parseCSV(text);
                
                if (rows.length < 2) {
                    throw new Error("CSV file must contain headers and at least one data row.");
                }

                const headers = rows[0];
                const dataRows = rows.slice(1);
                
                const inferredMappings = fuzzyMatchHeaders(headers, formFields);
                
                resolve({
                    headers,
                    dataRows,
                    inferredMappings
                });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error("Failed to read the file."));
        reader.readAsText(file);
    });
}
