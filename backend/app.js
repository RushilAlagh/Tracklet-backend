require("dotenv").config();

const express = require("express");
const awsServerlessExpress = require("aws-serverless-express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const monitorRoutes = require("./routes/monitorRoutes");
const { monitorProductsAndScrape } = require("./services/monitorService");

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json());
app.use(cors());

/* =========================
   ROUTES
========================= */
app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/monitor", monitorRoutes);

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

/* =========================
   🧪 LOCAL TEST ROUTE (IMPORTANT)
========================= */
app.get("/test-monitor", async (req, res) => {
  try {
    console.log("🧪 Manual monitor trigger started...");
    const result = await monitorProductsAndScrape();
    res.json(result);
  } catch (error) {
    console.error("❌ Error in manual trigger:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   CATCH-ALL
========================= */
app.all("*", (req, res) => {
  res.status(404).json({
    message: "Unknown route",
    path: req.path,
    method: req.method,
  });
});

/* =========================
   AWS LAMBDA SETUP
========================= */
const isLambda = !!process.env.AWS_EXECUTION_ENV;

let server;
if (isLambda) {
  server = awsServerlessExpress.createServer(app);
}

exports.handler = async (event, context) => {
  // 🕒 EventBridge trigger
  if (event?.source === "aws.events") {
    console.log("🕒 EventBridge triggered: Running monitoring...");
    await monitorProductsAndScrape();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Monitoring complete" }),
    };
  }

  // 🌐 API Gateway
  return awsServerlessExpress
    .proxy(server, event, context, "PROMISE")
    .promise;
};

/* =========================
   LOCAL DEVELOPMENT MODE
========================= */
if (!isLambda) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`✅ Local server running at http://localhost:${PORT}`);
  });

  /* =========================
     OPTIONAL LOCAL CRON
     Enable only when needed
  ========================= */
  if (process.env.ENABLE_LOCAL_CRON === "true") {
    const cron = require("node-cron");

    cron.schedule("*/5 * * * *", async () => {
      console.log("⏱️ Local cron triggered...");
      await monitorProductsAndScrape();
    });
  }
}