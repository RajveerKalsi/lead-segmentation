const puppeteer = require("puppeteer");
const fs = require("fs");
const Papa = require("papaparse");
const path = require("path");

// File paths
const INPUT_ASIN_CSV = path.join(__dirname, "data", "brand_asin_map.csv");
const RETRY_OUTPUT_CSV = path.join(__dirname, "data", "brand_asin_retry.csv");

// Helper delay
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Reuse your functions
const {
  sanitizeBrandName,
  getMatchedWordIndex,
  searchAmazonForBrand,
  setAmazonPincode,
} = require("./amazon-map-asin.js"); // <-- Update this if needed

// Parse CSV and return brands with 'no valid product'
function getInvalidBrands(csvPath) {
  const csvData = fs.readFileSync(csvPath, "utf8");
  const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });

  const uniqueBrands = new Set();
  parsed.data.forEach((row) => {
    if (
      row.asin === "no valid product" &&
      row.brandName &&
      !uniqueBrands.has(row.brandName)
    ) {
      uniqueBrands.add(row.brandName.trim());
    }
  });

  return Array.from(uniqueBrands);
}

// Append retry results
function appendRetryResults(results) {
  const fileExists = fs.existsSync(RETRY_OUTPUT_CSV);

  const csv = Papa.unparse(results, {
    header: !fileExists,
    skipEmptyLines: true,
  });

  fs.appendFileSync(RETRY_OUTPUT_CSV, (fileExists ? "\n" : "") + csv);
}

// Main
(async () => {
  const invalidBrands = getInvalidBrands(INPUT_ASIN_CSV);
  if (!invalidBrands.length) {
    return console.log("✅ No invalid brands to retry.");
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
      (Math.floor(Math.random() * 10) + 100) +
      ".0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-IN,en;q=0.9",
  });

  await page.setViewport({ width: 1280, height: 800 });
  await setAmazonPincode(page, "10001");

  for (const brand of invalidBrands) {
    const cleanedBrand = sanitizeBrandName(brand);
    console.log(`🔁 Retrying: "${brand}" → "${cleanedBrand}"`);

    let attempts = 0;
    let results = [];

    while (attempts < 5) {
      attempts++;
      results = await searchAmazonForBrand(page, cleanedBrand, "all");

      if (results.length > 0) {
        console.log(`✅ Succeeded after ${attempts} attempt(s)`);
        break;
      } else {
        console.log(`⏳ Attempt ${attempts}: No result yet`);
        await delay(2000);
      }
    }

    if (results.length > 0) {
      appendRetryResults(results);
    } else {
      appendRetryResults([
        {
          asin: "no valid product",
          brandName: brand,
          title: "no valid product",
          link: "no valid product",
          matchedWord: "no match",
        },
      ]);
    }

    await delay(3000);
  }

  await browser.close();
})();
