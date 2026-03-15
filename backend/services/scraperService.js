const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// Use the layer version of chromium, not the -min version
const chromium = require('@sparticuz/chromium'); 

puppeteer.use(StealthPlugin());

async function launchBrowser(options = {}) {
  const isLambda = process.env.AWS_EXECUTION_ENV !== undefined;

  if (isLambda) {
    // --- AWS PRODUCTION SETTINGS (Using the Layer you have) ---
    return {
      browser: await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(), // This now points to /opt
        headless: chromium.headless,
        ...options,
      }),
      page: await (await puppeteer.launch({ 
          args: chromium.args, 
          executablePath: await chromium.executablePath() 
      })).newPage() // Cleaner to just return the browser and let the function create the page
    };
  } else {
    // --- LOCAL WINDOWS SETTINGS ---
    browser = await puppeteer.launch({
      headless: "new", 
      defaultViewport: null, 
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", 
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--window-size=1920,1080', 
        '--disable-blink-features=AutomationControlled' 
      ],
      ...options,
    });
  }
  
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  return { browser, page };
}

// Set user agent and block unnecessary resources
async function setUserAgentAndBlockResources(page) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });
}

// Amazon Scraper
const scrapeAmazon = async (url) => {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    await setUserAgentAndBlockResources(page);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const priceText = await page.evaluate(() => {
      let priceElement;

      priceElement = document.querySelector('.apexPriceToPay .a-offscreen');
      if (priceElement) return priceElement.innerText;

      priceElement = document.querySelector('#corePriceDisplay_desktop_feature_div .a-price-whole');
      if (priceElement) return priceElement.innerText;
      
      priceElement = document.querySelector('#apex_desktop .a-price-whole');
      if (priceElement) return priceElement.innerText;

      priceElement = document.querySelector('#priceblock_ourprice');
      if (priceElement) return priceElement.innerText;

      priceElement = document.querySelector('.a-price-whole');
      if (priceElement) return priceElement.innerText;

      return null; 
    });

    if (!priceText) {
      console.log(`⚠️ Could not find any price selectors for URL: ${url}`);
      return null;
    }

    return priceText;

  } catch (error) {
    console.error(`Error scraping Amazon: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
};

// Ajio Scraper
async function scrapeAjio(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    // 1. Call the standard, shared setup function first
    await setUserAgentAndBlockResources(page);
    
    // 2. ONLY for Ajio: Inject realistic HTTP headers to look like a human Chrome user
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    });

    // Ajio is a heavy SPA, so we MUST wait for the network to idle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Add a random delay to simulate human loading time
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Wait until at least one element with a Rupee symbol appears (max 10s)
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('₹'),
        { timeout: 10000 }
      );
    } catch (e) {
      console.log("Timed out waiting for Rupee symbol to appear on Ajio.");
    }

    const priceText = await page.evaluate(() => {
      // Priority 1: Check the exact classes we know Ajio uses
      const classes = ['.prod-sp', '.price .prod-sp', '.price-section .price'];
      for (let selector of classes) {
        const el = document.querySelector(selector);
        // Using textContent to bypass headless rendering quirks
        if (el && el.textContent && el.textContent.includes('₹')) {
          return el.textContent.trim();
        }
      }

      // Priority 2: The "Smart Search" fallback
      const elements = Array.from(document.querySelectorAll('div, span, p'));
      const priceRegex = /₹\s?(\d{1,3}(,\d{2,3})*)/; 
      
      for (let el of elements) {
        if (el.children.length === 0 && el.textContent && priceRegex.test(el.textContent)) {
           return el.textContent.trim();
        }
      }

      return null;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find Ajio price selectors for URL: ${url}`);
      // Take a photograph to see if Ajio is blocking us!
      await page.screenshot({ path: 'ajio-error.png', fullPage: true });
      console.log(`📸 Saved debug screenshot to ajio-error.png`);
      return null;
    }

    return priceText;

  } catch (error) {
    console.error(`Error scraping Ajio: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Flipkart Scraper
async function scrapeFlipkart(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    await setUserAgentAndBlockResources(page);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Add a 2-second random delay to simulate human loading time
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Wait until at least one element with a Rupee symbol appears (max 10s)
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('₹'),
        { timeout: 10000 }
      );
    } catch (e) {
      console.log("Timed out waiting for Rupee symbol to appear.");
    }

    const priceText = await page.evaluate(() => {
      // Priority 1: Check the exact classes we've seen
      const classes = ['.v1zwn21k.v1zwn20', '._1psv1zeb9._1psv1ze0', '.Nx9bqj.CxhGGd', '._30jeq3._16Jk6d', '._1vC4OE._3qQ9m1', '.Nx9bqj'];
      for (let selector of classes) {
        const el = document.querySelector(selector);
        // Using textContent to bypass headless rendering quirks
        if (el && el.textContent && el.textContent.includes('₹')) {
          return el.textContent.trim();
        }
      }

      // Priority 2: The "Smart Search" fallback
      const elements = Array.from(document.querySelectorAll('div, span, p'));
      const priceRegex = /₹\s?(\d{1,3}(,\d{2,3})*)/; 
      
      for (let el of elements) {
        if (el.children.length === 0 && el.textContent && priceRegex.test(el.textContent)) {
           return el.textContent.trim();
        }
      }

      return null;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find Flipkart price selectors for URL: ${url}`);
      await page.screenshot({ path: 'flipkart-error.png', fullPage: true });
      console.log(`📸 Saved debug screenshot to flipkart-error.png`);
      return null;
    }

    return priceText;

  } catch (error) {
    console.error(`Error scraping Flipkart: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Nykaa Scraper
async function scrapeNykaa(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    // Nykaa specifically requires a mobile user agent
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      // Allowing stylesheets just in case Nykaa's mobile layout relies on them to render text blocks
      if (['image', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Wait for network to calm down
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Add a random delay to simulate human loading time
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Wait until at least one element with a Rupee symbol appears (max 10s)
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('₹'),
        { timeout: 10000 }
      );
    } catch (e) {
      console.log("Timed out waiting for Rupee symbol to appear on Nykaa.");
    }

    const priceText = await page.evaluate(() => {
      // Priority 1: Check the exact classes
      const classes = ['.css-1jczs19', '.css-1byl9fj', '.css-111z9ua'];
      for (let selector of classes) {
        // Use querySelectorAll to get ALL matches (both MRP and selling price)
        const elements = document.querySelectorAll(selector);
        for (let el of elements) {
          if (el && el.textContent && el.textContent.includes('₹')) {
            // Check if this specific element has a strikethrough line
            const style = window.getComputedStyle(el);
            if (!style.textDecoration.includes('line-through')) {
              return el.textContent.trim(); // Return the first one WITHOUT a strikethrough
            }
          }
        }
      }

      // Priority 2: The "Smart Search" fallback
      const elements = Array.from(document.querySelectorAll('span, div, p'));
      const priceRegex = /₹\s?(\d{1,3}(,\d{2,3})*)/; 
      
      for (let el of elements) {
        if (el.children.length === 0 && el.textContent && priceRegex.test(el.textContent)) {
           // Apply the exact same strikethrough check to our fallback!
           const style = window.getComputedStyle(el);
           if (!style.textDecoration.includes('line-through')) {
               return el.textContent.trim();
           }
        }
      }

      return null;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find Nykaa price selectors for URL: ${url}`);
      // Take a photograph just in case they have a bot wall too!
      await page.screenshot({ path: 'nykaa-error.png', fullPage: true });
      console.log(`📸 Saved debug screenshot to nykaa-error.png`);
      return null;
    }

    return priceText;

  } catch (error) {
    console.error(`Error scraping Nykaa: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Main export
async function scrapeProductPrice(url) {
  if (url.includes('amazon')) return await scrapeAmazon(url);
  else if (url.includes('ajio')) return await scrapeAjio(url);
  else if (url.includes('flipkart')) return await scrapeFlipkart(url);
  else if (url.includes('nykaa')) return await scrapeNykaa(url);
  else throw new Error('Unsupported website');
}

module.exports = { scrapeProductPrice };