const puppeteer = require("puppeteer");
const fs = require("fs");
const Papa = require("papaparse");
const path = require("path");

const INPUT_BRAND_CSV = path.join(__dirname, "data", "brand_keyword_map.csv");
const OUTPUT_ASIN_CSV = path.join(
  __dirname,
  "data",
  "brandName_for_keywords.csv"
);

(async () => {
  // Read input CSV
  const csvData = fs.readFileSync(INPUT_BRAND_CSV, "utf8");
  const parsed = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = parsed.data;
  const results = [];

  const browser = await puppeteer.launch({
    headless: false,
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

  // Helper to wait
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  for (const row of rows) {
    const { asin, keywordName } = row;
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    let brandName = "";
    let attempts = 0;

    while (!brandName && attempts < 100) {
      attempts++;
      try {
        await page.goto(productUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        try {
          brandName = await page.$eval(
            ".po-brand td.a-span9 span.a-size-base.po-break-word",
            (el) => el.textContent.trim()
          );
        } catch {
          try {
            const bylineText = await page.$eval("#bylineInfo", (el) =>
              el.textContent.trim()
            );
            const match = bylineText.match(/Brand:\s*(.+)/i);
            if (match) {
              brandName = match[1];
            }
          } catch {
            brandName = "";
          }
        }

        if (brandName) {
          console.log(`✓ ${asin} → ${brandName} (attempt ${attempts})`);
          break;
        } else {
          console.warn(`⟳ ${asin} retrying (${attempts}/100)...`);
          await delay(1000); // 1s delay
        }
      } catch (err) {
        console.error(`✗ ${asin} attempt ${attempts} failed: ${err.message}`);
        await delay(1000); // delay before retrying on failure
      }
    }

    results.push({ asin, keywordName, productUrl, brandName });

    // 💾 Save partial result after each row
    const partialCSV = Papa.unparse(results);
    fs.writeFileSync(OUTPUT_ASIN_CSV, partialCSV, "utf8");
  }

  await browser.close();

  // Write output CSV
  const outputCSV = Papa.unparse(results);
  fs.writeFileSync(OUTPUT_ASIN_CSV, outputCSV, "utf8");

  console.log("✅ Done. Results written to output.csv");
})();
