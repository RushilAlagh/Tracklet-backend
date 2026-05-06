const docClient = require("../config/dynamoConfig");
const { scrapeProductPrice } = require("./scraperService"); 
const { saveScrapeResult } = require("./scrapingService");
const { sendPriceDropAlert } = require("./emailService");

const PRODUCTS_TABLE = "Products";

/**
 * Fetches all products currently in the DynamoDB table.
 */
async function fetchAllTrackedProducts() {
  const params = {
    TableName: PRODUCTS_TABLE,
  };

  try {
    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (error) {
    console.error("Error fetching tracked products:", error.message);
    throw new Error("Failed to fetch tracked products.");
  }
}

/**
 * Updates the NotificationSent flag to true so we don't spam the user.
 */
async function updateNotificationSent(productID, userEmail) {
  const params = {
    TableName: PRODUCTS_TABLE,
    Key: {
      Product_ID: productID,
      User_Email: userEmail,
    },
    UpdateExpression: "SET NotificationSent = :sent",
    ExpressionAttributeValues: {
      ":sent": true,
    },
  };

  try {
    await docClient.update(params).promise();
    console.log(`✅ NotificationSent updated for Product_ID ${productID}`);
  } catch (error) {
    console.error(`Error updating NotificationSent for ${productID}:`, error.message);
  }
}

/**
 * Main logic: Scans DB, scrapes prices in chunks, and sends alerts.
 */
async function monitorProductsAndScrape() {
  console.log("🚀 Starting monitoring cycle...");
  console.log("📌 SEND_EMAILS =", process.env.SEND_EMAILS);

  const trackedProducts = await fetchAllTrackedProducts();

  if (trackedProducts.length === 0) {
    console.log("⚡ No products being tracked currently.");
    return { message: "No products to monitor." };
  }

  const CHUNK_SIZE = 3;

  for (let i = 0; i < trackedProducts.length; i += CHUNK_SIZE) {
    const chunk = trackedProducts.slice(i, i + CHUNK_SIZE);
    console.log(`Processing batch ${Math.floor(i / CHUNK_SIZE) + 1}...`);
    
    await Promise.all(chunk.map(async (product) => {
      const { Product_ID, User_Email, Product_URL, Threshold_Value, NotificationSent } = product;

      // Skip if already notified
      if (NotificationSent === true) {
        console.log(`⏭️ Skipping ${Product_ID} (already notified)`);
        return;
      }

      try {
        const scrapedPriceStr = await scrapeProductPrice(Product_URL);

        if (!scrapedPriceStr) {
          console.warn(`⚠️ Could not get price for ${Product_ID}`);
          return;
        }

        const numericPrice = parseFloat(
          scrapedPriceStr.replace(/[^0-9.]/g, '')
        );

        if (isNaN(numericPrice)) {
          console.warn(`⚠️ Invalid numeric price for ${Product_ID}: ${scrapedPriceStr}`);
          return;
        }

        console.log(`💰 ${Product_ID} price: ${numericPrice} | Threshold: ${Threshold_Value}`);

        // 1. Save price history
        await saveScrapeResult(Product_ID, User_Email, numericPrice);

        // 2. Check threshold
        if (numericPrice <= Number(Threshold_Value)) {
          console.log(`💥 PRICE DROP DETECTED: ${numericPrice} (Threshold: ${Threshold_Value})`);

          // ✅ Controlled email sending
          if (process.env.SEND_EMAILS === "true") {
            await sendPriceDropAlert(User_Email, Product_URL, numericPrice);
            console.log(`📧 Email sent to ${User_Email}`);
          } else {
            console.log("📭 Email skipped (SEND_EMAILS=false)");
          }

          // Mark as notified
          await updateNotificationSent(Product_ID, User_Email);

        } else {
          console.log(`✅ ${Product_ID} is stable at ${numericPrice}`);
        }

      } catch (error) {
        console.error(`❌ Failed to process Product ${Product_ID}:`, error.message);
      }
    }));
  }

  console.log("🏁 Monitoring cycle finished.");
  return { message: "Monitoring completed." };
}

module.exports = {
  monitorProductsAndScrape,
};