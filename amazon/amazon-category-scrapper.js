const puppeteer = require("puppeteer");
const fs = require("fs");
const Papa = require("papaparse");
const path = require("path");

const INPUT_CSV = path.join(__dirname, "data", "brand_asin_map.csv");
const OUTPUT_CSV = path.join(__dirname, "data", "amazon_product_details.csv");

// Read ASINs and related metadata from CSV
function readASINs() {
  try {
    const file = fs.readFileSync(INPUT_CSV, "utf8");
    const parsed = Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
    });
    return parsed.data
      .map((row) => ({
        asin: row["asin"]?.trim(),
        brandName: row["brandName"]?.trim(),
        title: row["title"]?.trim(),
        link: row["link"]?.trim(),
        matchedWord: row["matchedWord"]?.trim(),
      }))
      .filter((row) => row.asin && row.link);
  } catch (error) {
    console.error("Failed to read asins list from CSV:", error);
    return [];
  }
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Append a single record to the CSV file
function appendToCSV(record) {
  const exists = fs.existsSync(OUTPUT_CSV);
  const csv = Papa.unparse([record], {
    header: !exists, // Include header only if file doesn't exist
    skipEmptyLines: true,
  });

  fs.appendFileSync(OUTPUT_CSV, csv + "\n");
  console.log(`Appended ASIN: ${record.asin}`);
}

async function scrapeDetails(page, product) {
  let attempt = 0;
  let breadcrumbs = [];
  let productTitle = "";
  let brandInfo = "";

  while (attempt < 100) {
    try {
      await page.goto(product.link, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForSelector("#productTitle", { timeout: 15000 });

      breadcrumbs = await page.evaluate(() => {
        const el = document.querySelectorAll(
          "#wayfinding-breadcrumbs_feature_div ul.a-unordered-list li span.a-list-item a"
        );
        return Array.from(el)
          .map((e) => e.innerText.trim())
          .filter(Boolean);
      });

      if (breadcrumbs.length === 0) throw new Error("No breadcrumbs");

      ({ productTitle, brandInfo } = await page.evaluate(() => {
        return {
          productTitle:
            document.querySelector("#productTitle")?.innerText.trim() || "",
          brandInfo:
            document
              .querySelector("#bylineInfo")
              ?.innerText.replace("Brand: ", "")
              .trim() || "",
        };
      }));

      return {
        asin: product.asin,
        searchedBrand: product.brandName,
        productTitle,
        breadcrumbs: breadcrumbs.join(" > "),
        brandInfo,
        link: product.link,
        scrapedAt: new Date().toISOString(),
        status: "success",
      };
    } catch (err) {
      attempt++;
      console.log(`Retrying (${attempt}/100) for ${product.link}`);
      await delay(2000 + Math.random() * 2000);
    }
  }

  return {
    asin: product.asin,
    searchedBrand: product.brandName,
    productTitle: "failed to scrape",
    breadcrumbs: "failed to scrape",
    brandInfo: "failed to scrape",
    link: product.link,
    scrapedAt: new Date().toISOString(),
    status: "failed",
  };
}

(async () => {
  const products = readASINs();
  if (products.length === 0) return console.log("No ASINs to process.");

  const asinList = products.map((p) => p.asin);
  console.log("ASINs to be scraped:", asinList.join(", "));

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

  for (const product of products) {
    if (product.asin.toLowerCase() === "no valid product") {
      console.log(
        `Skipping ASIN: ${product.asin} (marked as no valid product)`
      );
      continue;
    }

    console.log(`Scraping ASIN: ${product.asin}`);
    const data = await scrapeDetails(page, product);

    if (data.status === "success") {
      console.log(`Successfully scraped: ${data.asin}`);
    } else {
      console.log(`Failed to scrape after 100 attempts: ${data.asin}`);
    }

    appendToCSV(data);
  }

  await browser.close();
})();
