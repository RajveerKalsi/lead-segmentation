const puppeteer = require("puppeteer");
const fs = require("fs");
const Papa = require("papaparse");
const path = require("path");

const INPUT_BRAND_CSV = path.join(
  __dirname,
  "data",
  "company_name_deduped.csv"
);
const OUTPUT_ASIN_CSV = path.join(__dirname, "data", "brand_asin_map.csv");

// Delay helper
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Read brand names from input CSV
function readBrandsFromCSV(filePath) {
  try {
    const csvData = fs.readFileSync(filePath, "utf8");
    const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
    return parsed.data
      .map((row) => row["Company Names"]?.trim())
      .filter(Boolean);
  } catch (err) {
    console.error("Failed to read brand list from CSV:", err);
    return [];
  }
}

function sanitizeBrandName(brandName) {
  if (!brandName) return "";

  // Remove domain suffixes like .com, .net, .org, etc.
  brandName = brandName.replace(/\.(com|net|org|biz|io|co|us|uk|info)$/i, "");

  // List of standalone legal entity suffixes to remove
  const legalSuffixes = [
    "inc",
    "inc.",
    "llc",
    "l.l.c.",
    "corp",
    "corp.",
    "corporation",
    "co",
    "co.",
    "ltd",
    "ltd.",
    "plc",
    "gmbh",
    "ltda",
    "group",
    "company",
    "Paper & Press",
  ];

  let words = brandName.split(/\s+/).filter((word) => {
    return !legalSuffixes.includes(word.toLowerCase());
  });

  words = words.map((word, index) => {
    let cleaned = word
      .replace(/Â®/g, "") // Remove trademark artifacts
      .replace(/[^\w\s\-&']/g, ""); // Remove unwanted symbols

    // Fix common case: "Its Skinny" -> "It's Skinny"
    if (index === 0 && cleaned === "Its") {
      cleaned = "It's";
    }

    return cleaned;
  });

  return words.join(" ").trim();
}

// Append results to output CSV
function appendASINResults(results) {
  const fileExists = fs.existsSync(OUTPUT_ASIN_CSV);

  const cleanedResults = results.map((r) => ({
    asin: r.asin || "",
    brandName: r.brandName || "",
    title: r.title || "",
    link: r.link || "",
    matchedWord: r.matchedWord || "",
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

    // Click the location pin icon on navbar
    await page.waitForSelector("#nav-global-location-popover-link", {
      timeout: 10000,
    });
    await page.click("#nav-global-location-popover-link");

    // Wait for pincode input field and type the pincode
    await page.waitForSelector("#GLUXZipUpdateInput", { timeout: 10000 });
    await page.click("#GLUXZipUpdateInput", { clickCount: 3 });
    await page.type("#GLUXZipUpdateInput", pincode, { delay: 100 });

    // Click the Apply button
    await page.waitForSelector("#GLUXZipUpdate", { timeout: 10000 });
    await page.click("#GLUXZipUpdate");

    // Optional: wait and handle the "Continue" popup
    try {
      await page.waitForSelector("#GLUXConfirmClose", { timeout: 7000 });
      await page.click("#GLUXConfirmClose");
      console.log("✅ Confirmed new delivery location.");
    } catch (popupErr) {
      console.log("ℹ️ No confirmation popup appeared.");
    }

    // Give time for page to reflect the location update
    await delay(3000);
    console.log("✅ Pincode set to", pincode);
  } catch (err) {
    console.warn("⚠️ Failed to set pincode:", err.message);
  }
}

// Word-level match between brand name and scraped brand text
function getMatchedWordIndex(brandName, brandText) {
  if (!brandName || !brandText) return { matched: false };

  const brandLower = brandText.toLowerCase().trim();
  const targetBrandLower = brandName.toLowerCase().trim();

  // ✅ First check for full exact match
  if (brandLower === targetBrandLower) {
    return {
      matched: true,
      word: targetBrandLower,
      index: 0,
      fullMatch: true,
    };
  }

  // Fallback: word-level partial match
  const words = targetBrandLower.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    if (brandLower.includes(words[i])) {
      return {
        matched: true,
        word: words[i],
        index: i + 1,
        fullMatch: false,
      };
    }
  }

  return { matched: false };
}

// Main search logic
async function searchAmazonForBrand(page, brandName, maxCards = "all") {
  const query = encodeURIComponent(brandName);
  const url = `https://www.amazon.com/s?k=${query}`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const rawProducts = await page.evaluate(() => {
    const productNodes = document.querySelectorAll(
      "div.s-main-slot div.s-result-item[data-asin]"
    );
    const items = [];

    productNodes.forEach((el) => {
      const titleElement = el.querySelector("h2 span");
      const linkElement = el.querySelector("a.a-link-normal.s-no-outline");
      const brandElement = el.querySelector(
        'div[data-cy="title-recipe"] h2 span'
      );
      const asin = el.getAttribute("data-asin");

      const title = titleElement?.innerText?.trim() || "";
      const brandText = brandElement?.innerText?.trim() || "";
      const link = linkElement?.href
        ? "https://www.amazon.com" + linkElement.getAttribute("href")
        : "";

      if (title && link && asin) {
        items.push({ asin, title, brandText, link });
      }
    });

    return items;
  }, brandName);

  // Separate exact matches and partial matches
  const exactMatches = [];
  const partialMatches = [];

  for (const product of rawProducts) {
    const match = getMatchedWordIndex(brandName, product.brandText);
    if (match.matched) {
      const matchedEntry = {
        asin: product.asin,
        brandName,
        title: product.title,
        link: product.link,
        matchedWord: match.fullMatch ? "Exact Match" : `Word ${match.index}`,
      };

      if (match.fullMatch) {
        exactMatches.push(matchedEntry);
      } else {
        partialMatches.push(matchedEntry);
      }
    }
  }

  // Use exact matches if any, else partial matches
  const finalMatches = exactMatches.length > 0 ? exactMatches : partialMatches;

  console.log(
    `\n[${brandName}] Found ${finalMatches.length} matching product(s) (Exact: ${exactMatches.length}, Partial: ${partialMatches.length})`
  );

  const limit =
    maxCards === "all" ? finalMatches.length : parseInt(maxCards, 10);
  return finalMatches.slice(0, limit);
}

// Main runner
(async () => {
  const brands = readBrandsFromCSV(INPUT_BRAND_CSV);
  if (!brands.length) return console.log("No brands to process.");

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

  for (const brand of brands) {
    const cleanedBrand = sanitizeBrandName(brand);
    console.log(`Original: "${brand}" → Cleaned: "${cleanedBrand}"`);

    let attempts = 0;
    let results = [];

    while (attempts < 100) {
      attempts++;
      results = await searchAmazonForBrand(page, cleanedBrand, maxCards);

      if (results.length > 0) {
        console.log(
          `✅ [${cleanedBrand}] Succeeded after ${attempts} attempt(s)`
        );
        break;
      } else {
        console.log(
          `🔁 [${cleanedBrand}] Attempt ${attempts}: No matching products, retrying...`
        );
        await delay(2000);
      }
    }

    if (results.length > 0) {
      appendASINResults(results);
    } else {
      console.log(
        `❌ [${cleanedBrand}] No valid product found after 10 retries.`
      );
      appendASINResults([
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
