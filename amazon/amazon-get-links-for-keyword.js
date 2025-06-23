const puppeteer = require("puppeteer");
const fs = require("fs");
const Papa = require("papaparse");
const path = require("path");

const INPUT_BRAND_CSV = path.join(__dirname, "data", "keyword_brand_scrap.csv");
const OUTPUT_ASIN_CSV = path.join(__dirname, "data", "brand_keyword_map.csv");

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function readKeywordsFromCSV(filePath) {
  try {
    const csvData = fs.readFileSync(filePath, "utf8");
    const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
    return parsed.data
      .map((row) => row["Keywords"]?.trim())
      .filter(Boolean);
  } catch (err) {
    console.error("Failed to read keyword list from CSV:", err);
    return [];
  }
}

function appendKeywordResults(results) {
  const fileExists = fs.existsSync(OUTPUT_ASIN_CSV);

  const cleanedResults = results.map((r) => ({
    asin: r.asin || "",
    keywordName: r.keywordName || "",
    link: r.link || "",
  }));

  const csv = Papa.unparse(cleanedResults, {
    header: !fileExists,
    skipEmptyLines: true,
  });

  fs.appendFileSync(OUTPUT_ASIN_CSV, (fileExists ? "\n" : "") + csv);
}

async function setAmazonPincode(page, pincode = "10001") {
  try {
    await page.goto("https://www.amazon.com/s?k=NIKE", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForSelector("#nav-global-location-popover-link", {
      timeout: 10000,
    });
    await page.click("#glow-ingress-block");

    await page.waitForSelector("#GLUXZipUpdateInput", { timeout: 10000 });
    await page.click("#GLUXZipUpdateInput", { clickCount: 3 });
    await page.type("#GLUXZipUpdateInput", pincode, { delay: 100 });

    await page.waitForSelector("#GLUXZipUpdate", { timeout: 10000 });
    await page.click("#GLUXZipUpdate");

    try {
      await page.waitForSelector("#GLUXConfirmClose", { timeout: 7000 });
      await page.click("#GLUXConfirmClose");
      console.log("✅ Confirmed new delivery location.");
    } catch {
      console.log("ℹ️ No confirmation popup appeared.");
    }

    await delay(3000);
    console.log("✅ Pincode set to", pincode);
  } catch (err) {
    console.warn("⚠️ Failed to set pincode:", err.message);
  }
}

async function searchAmazonForKeyword(page, keywordName, maxCards = "all") {
  const query = encodeURIComponent(keywordName);
  const url = `https://www.amazon.com/s?k=${query}`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const products = await page.evaluate(() => {
    const nodes = document.querySelectorAll("div.s-main-slot div.s-result-item[data-asin]");
    const data = [];

    nodes.forEach((el) => {
      const asin = el.getAttribute("data-asin");
      const linkPart = el.querySelector("a.a-link-normal.s-no-outline")?.getAttribute("href") || "";

      if (asin && linkPart) {
        data.push({
          asin,
          link: "https://www.amazon.com" + linkPart,
        });
      }
    });

    return data;
  });

  console.log(`[${keywordName}] Found ${products.length} product(s).`);

  const limit = maxCards === "all" ? products.length : parseInt(maxCards, 10);
  return products.slice(0, limit).map((item) => ({
    ...item,
    keywordName,
  }));
}

(async () => {
  const keywords = readKeywordsFromCSV(INPUT_BRAND_CSV);
  if (!keywords.length) return console.log("No keywords to process.");

  const maxCards = process.argv[2] || "all";

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

  await setAmazonPincode(page, "10001");

  for (const keyword of keywords) {
    let results = [];
    let attempts = 0;

    while (attempts < 3) {
      attempts++;
      try {
        results = await searchAmazonForKeyword(page, keyword, maxCards);
        if (results.length > 0) break;
      } catch (err) {
        console.warn(`Error on attempt ${attempts} for "${keyword}":`, err.message);
      }
      await delay(2000);
    }

    if (results.length > 0) {
      appendKeywordResults(results);
    } else {
      console.log(`❌ [${keyword}] No results found.`);
      appendKeywordResults([
        {
          asin: "no valid product",
          keywordName: keyword,
          link: "no valid product",
        },
      ]);
    }

    await delay(3000);
  }

  await browser.close();
})();
