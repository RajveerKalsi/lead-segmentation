const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

const INPUT_CSV = path.join(__dirname, "data", "company_name.csv");
const OUTPUT_CSV = path.join(__dirname, "data", "company_name_deduped.csv");

function removeDuplicatesFromCSV(inputPath, outputPath) {
  try {
    const fileContent = fs.readFileSync(inputPath, "utf8");
    const parsed = Papa.parse(fileContent, { header: true });

    const companyNames = parsed.data
      .map((row) => row["Company Names"]?.trim())
      .filter(Boolean);

    const uniqueNames = Array.from(new Set(companyNames));

    const cleanedData = uniqueNames.map((name) => ({ "Company Names": name }));

    const csvOutput = Papa.unparse(cleanedData, { header: true });

    fs.writeFileSync(outputPath, csvOutput);
    console.log(`Deduplicated list written to ${outputPath}`);
  } catch (err) {
    console.error("Error processing CSV:", err.message);
  }
}

removeDuplicatesFromCSV(INPUT_CSV, OUTPUT_CSV);
