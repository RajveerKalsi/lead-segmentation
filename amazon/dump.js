const fs = require('fs');
const Papa = require('papaparse');

// Read the CSV file as text
const csvFile = fs.readFileSync('brand_asin_map.csv', 'utf8');

// Parse the CSV
const parsed = Papa.parse(csvFile, {
  header: true,
  skipEmptyLines: true,
});

// Extract ASINs
const asins = parsed.data.map(row => row.asin).filter(Boolean);

console.log('ASINs:', asins);
