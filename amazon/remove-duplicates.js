const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

const INPUT_CSV = path.join(__dirname, "data", "ICP_data_scrapping.csv");
const OUTPUT_DEDUPED_CSV = path.join(__dirname, "data", "company_name_deduped.csv");
const OUTPUT_DUPLICATES_CSV = path.join(__dirname, "data", "duplicate_company_names.csv");

function removeDuplicatesFromCSV(inputPath, dedupedPath, duplicatesPath) {
  try {
    const fileContent = fs.readFileSync(inputPath, "utf8");
    const parsed = Papa.parse(fileContent, { header: true });

    const companyNames = parsed.data
      .map((row) => row["Company Names"]?.trim())
      .filter(Boolean);

    const seen = new Set();
    const duplicates = new Set();
    const uniqueNames = [];

    for (const name of companyNames) {
      if (seen.has(name)) {
        duplicates.add(name);
      } else {
        seen.add(name);
        uniqueNames.push(name);
      }
    }

    // Write deduplicated list
    const dedupedData = uniqueNames.map((name) => ({ "Company Names": name }));
    const dedupedCSV = Papa.unparse(dedupedData, { header: true });
    fs.writeFileSync(dedupedPath, dedupedCSV);
    console.log(`✅ Deduplicated list written to ${dedupedPath}`);

    // Write duplicates list
    const duplicateData = Array.from(duplicates).map((name) => ({ "Company Names": name }));
    const duplicateCSV = Papa.unparse(duplicateData, { header: true });
    fs.writeFileSync(duplicatesPath, duplicateCSV);
    console.log(`✅ Duplicates list written to ${duplicatesPath}`);
  } catch (err) {
    console.error("❌ Error processing CSV:", err.message);
  }
}

removeDuplicatesFromCSV(INPUT_CSV, OUTPUT_DEDUPED_CSV, OUTPUT_DUPLICATES_CSV);
