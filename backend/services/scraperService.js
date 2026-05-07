// Force puppeteer-extra to use puppeteer-core
const { addExtra } = require('puppeteer-extra');
const puppeteerCore = require('puppeteer-core');
const puppeteer = addExtra(puppeteerCore);

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

async function launchBrowser(options = {}) {
  const isLambda = process.env.AWS_EXECUTION_ENV !== undefined;

  let browser;

  if (isLambda) {
    // ✅ AWS Lambda
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ...options,
    });
  } else {
    // ✅ Local (Windows)
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

  // Hide automation
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  return { browser, page };
}

module.exports = { launchBrowser };

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

// AMAZON SCRAPER (FULL OPTIMIZED VERSION)

const scrapeAmazon = async (url) => {
  let browser, page;

  try {
    // Note: Assumes launchBrowser() is defined elsewhere in your file
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    // 1. Force a strict Desktop environment to prevent mobile DOM or default location routing
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 2. Call your existing resource blocker to save memory and speed up load times
    await setUserAgentAndBlockResources(page);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for dynamic content to load in the Buy Box
    await new Promise(r => setTimeout(r, 3000));

    // 3. Debugging: Grab the title so we know exactly what product the bot is looking at in CloudWatch
    const title = await page.evaluate(() => {
      const titleEl = document.querySelector('#productTitle');
      return titleEl ? titleEl.innerText.trim() : 'Unknown Title';
    });
    console.log(`🤖 Bot sees Title: ${title}`);

    // 4. Extract the exact Buy Box price safely using refined safe-zone selectors
    const priceText = await page.evaluate(() => {
      let priceElement;

      // ✅ Priority 1: Strict Desktop Buy Box 
      priceElement = document.querySelector('#corePriceDisplay_desktop_feature_div .a-price-whole');
      if (priceElement) return priceElement.innerText;

      // ✅ Priority 2: Alternative Desktop container
      priceElement = document.querySelector('#apex_desktop .a-price-whole');
      if (priceElement) return priceElement.innerText;

      // ✅ Priority 3: The Center Column (Very Safe)
      // This is the middle of the page with the title and bullets. 
      // It completely ignores the "Sponsored" rows at the bottom.
      priceElement = document.querySelector('#centerCol .a-price-whole');
      if (priceElement) return priceElement.innerText;

      // ✅ Priority 4: The Right Column (The actual Buy Box panel)
      priceElement = document.querySelector('#rightCol .a-price-whole');
      if (priceElement) return priceElement.innerText;

      // ✅ Priority 5: Legacy Amazon Desktop Layouts
      priceElement = document.querySelector('#priceblock_ourprice');
      if (priceElement) return priceElement.innerText;

      priceElement = document.querySelector('#priceblock_dealprice');
      if (priceElement) return priceElement.innerText;

      // No broad fallback regex allowed here to prevent grabbing sponsored prices
      return null;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find exact desktop buy-box price for URL: ${url}`);
      return null;
    }

    console.log(`💰 Amazon price found: ${priceText}`);
    return priceText;

  } catch (error) {
    console.error(`❌ Error scraping Amazon: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
};

// --- NEW: Snapdeal Scraper ---
async function scrapeSnapdeal(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    await setUserAgentAndBlockResources(page);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000)); // Human delay

    const priceText = await page.evaluate(() => {
      // Priority 1: Snapdeal's standard price class
      const el = document.querySelector('.payBlkBig');
      if (el && el.textContent) return el.textContent.trim();

      // Priority 2: Smart Search Fallback
      const elements = Array.from(document.querySelectorAll('span, div'));
      const priceRegex = /^(?:Rs\.?|INR|₹)\s?(\d{1,3}(?:,\d{2,3})*)/i; 
      
      for (let el of elements) {
        if (el.children.length === 0 && el.textContent && priceRegex.test(el.textContent.trim())) {
           return el.textContent.trim();
        }
      }
      return null;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find Snapdeal price for: ${url}`);
      return null;
    }

    return priceText;
  } catch (error) {
    console.error(`❌ Error scraping Snapdeal: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// --- BULLETPROOF: Reliance Digital Scraper ---
async function scrapeRelianceDigital(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Aggressive blocking: Stop images, fonts, media, and websockets. Allow only essentials.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const blocked = ['image', 'media', 'font', 'websocket', 'manifest'];
      if (blocked.includes(req.resourceType())) {
        req.abort(); 
      } else {
        req.continue(); 
      }
    });
    
    // 🚀 THE NUCLEAR OPTION: Try to load, but ignore timeouts
    try {
      // Cut timeout to 30s. If it hangs past this, we force it to move on.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log("⚠️ page.goto timed out, but proceeding to check for the price anyway...");
    }

    // Give Vue.js a few seconds to inject the price into the HTML
    await new Promise(r => setTimeout(r, 3000));

    try {
      await page.waitForSelector('.product-price', { timeout: 10000 });
    } catch (e) {
      console.log("⚠️ Timed out waiting for .product-price to appear on Reliance Digital.");
    }

    const priceText = await page.evaluate(() => {
      // Priority 1: The exact class from the Vue.js frontend
      const semanticSelectors = [
        '.product-price',
        '.pdp__priceSection__priceListText', 
        '.pdp__priceSection__priceListTextString'
      ];
      
      for (let selector of semanticSelectors) {
        const elements = document.querySelectorAll(selector);
        for (let el of elements) {
          if (el && el.textContent && el.textContent.includes('₹')) {
            return el.textContent.trim();
          }
        }
      }

      // Priority 2: Smart Search Fallback
      const elements = Array.from(document.querySelectorAll('span, li, div, p'));
      const priceRegex = /₹\s?(\d{1,3}(,\d{2,3})*(\.\d{1,2})?)/; 
      
      for (let el of elements) {
        if (el.children.length === 0 && el.textContent && priceRegex.test(el.textContent)) {
           if (!el.textContent.toLowerCase().includes('mo') && !el.closest('.emi-block')) {
               return el.textContent.trim();
           }
        }
      }
      return null;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find Reliance Digital price selectors for URL: ${url}`);
      await page.screenshot({ path: 'reliance-error.png', fullPage: true });
      console.log(`📸 Saved debug screenshot to reliance-error.png`);
      return null;
    }

    console.log(`💰 Reliance Digital price found: ${priceText}`);
    return priceText;

  } catch (error) {
    console.error(`❌ Error scraping Reliance Digital: ${error.message}`);
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

// --- FINAL: JioMart Scraper (The Googlebot JSON-LD Bypass) ---
async function scrapeJioMart(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    await page.setCookie({
        name: 'pincode',
        value: '249403', // Your Haridwar pincode
        domain: '.jiomart.com',
        path: '/'
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'media', 'websocket', 'font'].includes(req.resourceType())) {
        req.abort(); 
      } else {
        req.continue(); 
      }
    });
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log("⚠️ page.goto timed out for JioMart, checking anyway...");
    }

    await new Promise(r => setTimeout(r, 2000));
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    
    // 🚀 NEW PRIORITY 1: The Googlebot JSON-LD Bypass
    // Extract price directly from SEO metadata before looking at the visual page
    let seoPrice = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let script of scripts) {
            try {
                const data = JSON.parse(script.innerText);
                // Handle both single objects and arrays of schema objects
                const items = Array.isArray(data) ? data : [data];
                for (let item of items) {
                    if (item['@type'] === 'Product' && item.offers) {
                        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                        if (offer && offer.price) {
                            return `₹${offer.price}`;
                        }
                    }
                }
            } catch (err) {
                // Ignore parse errors on individual scripts
            }
        }
        return null;
    });

    // If the SEO bypass worked, return the price immediately!
    if (seoPrice) {
        console.log(`💰 JioMart price found via SEO JSON-LD Bypass: ${seoPrice}`);
        return seoPrice;
    }

    // --- FALLBACK TO VISUAL SCRAPING IF JSON-LD FAILS ---

    const isUnavailable = await page.evaluate(() => {
        const text = (document.body.innerText || "").toLowerCase();
        return text.includes('currently unavailable') || 
               text.includes('out of stock') || 
               text.includes('sold out') ||
               text.includes('page not found') ||
               text.includes('we couldn\'t find the page') ||
               text.includes('something went wrong');
    });

    if (isUnavailable) {
        console.log(`⚠️ Product is Out of Stock or Missing on JioMart visually: ${url}`);
        await page.screenshot({ path: '/tmp/jiomart-error.png', fullPage: true });
        return null;
    }

    const priceText = await page.evaluate(() => {
      const extractNumbers = (text) => {
          const match = text.replace(/,/g, '').match(/\d+(\.\d{1,2})?/);
          return match ? `₹${match[0]}` : null;
      };

      let maxFontSize = 0;
      let bestPrice = null;

      const allPrices = Array.from(document.querySelectorAll('.PriceContainer__currentPrice, .jm-heading-xl, .product-price, .jm-heading-s'));
      for (let el of allPrices) {
         if (el.closest('.swiper-container') || el.closest('.carousel') || el.closest('.slick-slider') || el.closest('aside')) continue;
         if (el.textContent && el.textContent.includes('₹')) {
             const style = window.getComputedStyle(el);
             if (style.textDecoration.includes('line-through')) continue;
             const fontSize = parseFloat(style.fontSize) || 0;
             if (fontSize > maxFontSize) {
                 const cleaned = extractNumbers(el.textContent);
                 if (cleaned) { maxFontSize = fontSize; bestPrice = cleaned; }
             }
         }
      }

      if (bestPrice) return bestPrice;

      const allElements = Array.from(document.querySelectorAll('*'));
      for (let el of allElements) {
         if (el.children.length > 0 || !el.textContent || !el.textContent.includes('₹')) continue;
         if (el.closest('.swiper-container') || el.closest('.carousel') || el.closest('.slick-slider')) continue;
         const style = window.getComputedStyle(el);
         if (style.textDecoration.includes('line-through') || el.textContent.includes('%')) continue;
         const fontSize = parseFloat(style.fontSize) || 0;
         if (fontSize > maxFontSize) {
             const cleaned = extractNumbers(el.textContent);
             if (cleaned) { maxFontSize = fontSize; bestPrice = cleaned; }
         }
      }
      return bestPrice;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find JioMart price visually for URL: ${url}`);
      await page.screenshot({ path: '/tmp/jiomart-error.png', fullPage: true });
      return null;
    }

    console.log(`💰 JioMart price found visually: ${priceText}`);
    return priceText;

  } catch (error) {
    console.error(`❌ Error scraping JioMart: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// --- UPDATED: Main Export ---
async function scrapeProductPrice(url) {
  if (url.includes('amazon')) return await scrapeAmazon(url);
  else if (url.includes('nykaa')) return await scrapeNykaa(url);
  else if (url.includes('snapdeal')) return await scrapeSnapdeal(url);
  else if (url.includes('reliancedigital')) return await scrapeRelianceDigital(url);
  else if (url.includes('jiomart')) return await scrapeJioMart(url); // <-- Added JioMart
  else {
    console.warn(`⚠️ Unsupported website attempted: ${url}`);
    return null; 
  }
}

module.exports = { scrapeProductPrice, launchBrowser };