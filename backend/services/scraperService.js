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

// --- JioMart Scraper (Pincode Modal Fix) ---
async function scrapeJioMart(url) {
  let browser, page;
  try {
    const browserInstance = await launchBrowser();
    browser = browserInstance.browser;
    page = browserInstance.page;

    // ─── Stealth patches ──────────────────────────────────────────────────────
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Upgrade-Insecure-Requests': '1',
    });

    // Set ALL known JioMart pincode-related cookies before navigation
    const PINCODE = '249403';
    const cookies = [
      { name: 'pincode',       value: PINCODE,    domain: '.jiomart.com', path: '/' },
      { name: 'selected_pincode', value: PINCODE, domain: '.jiomart.com', path: '/' },
      { name: 'userPincode',   value: PINCODE,    domain: '.jiomart.com', path: '/' },
      { name: 'deliveryPincode', value: PINCODE,  domain: '.jiomart.com', path: '/' },
    ];
    await page.setCookie(...cookies);

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'websocket', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // ─── Step 1: Load homepage first to establish session ─────────────────────
    // JioMart checks session state. Landing directly on a product URL cold
    // triggers the pincode modal. Going via homepage first seeds the session.
    console.log('🏠 Loading JioMart homepage to seed session...');
    try {
      await page.goto('https://www.jiomart.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log('⚠️ Homepage load timed out, continuing...');
    }
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));

    // ─── Step 2: Enter pincode via the modal/input if present ─────────────────
    try {
      // Look for a pincode input on the homepage
      const pincodeInput = await page.$('input[placeholder*="pincode" i], input[placeholder*="pin code" i], input[id*="pincode" i], input[name*="pincode" i], #pincode-input');
      if (pincodeInput) {
        console.log('📍 Found pincode input, entering pincode...');
        await pincodeInput.click({ clickCount: 3 }); // select all existing text
        await pincodeInput.type(PINCODE, { delay: 80 });
        await new Promise((r) => setTimeout(r, 500));

        // Try pressing Enter or clicking confirm button
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 1500));
        console.log('✅ Pincode entered on homepage');
      } else {
        console.log('ℹ️ No pincode input found on homepage, trying API approach...');
      }
    } catch (e) {
      console.log(`⚠️ Pincode input interaction failed: ${e.message}`);
    }

    // ─── Step 3: Hit JioMart's pincode API directly ───────────────────────────
    // This is the same API their frontend calls when you enter a pincode.
    // Calling it directly sets the server-side session pincode.
    try {
      const pincodeApiResult = await page.evaluate(async (pincode) => {
        try {
          const res = await fetch(
            `https://www.jiomart.com/api/service/address/pincode/validate?pincode=${pincode}`,
            {
              method: 'GET',
              credentials: 'include',
              headers: { 'Accept': 'application/json' },
            }
          );
          const data = await res.json();
          return { ok: res.ok, status: res.status, data };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }, PINCODE);
      console.log(`📍 Pincode API result: ${JSON.stringify(pincodeApiResult)}`);
    } catch (e) {
      console.log(`⚠️ Pincode API call failed: ${e.message}`);
    }

    // Short wait after pincode setup
    await new Promise((r) => setTimeout(r, 800));

    // ─── Step 4: Now navigate to the actual product page ─────────────────────
    console.log(`🛒 Navigating to product: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.log('⚠️ Product page goto timed out, checking anyway...');
    }

    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    // ─── Debug ────────────────────────────────────────────────────────────────
    const pageTitle = await page.title();
    console.log(`📄 Product page title: "${pageTitle}" | URL: ${page.url()}`);

    // ─── PRIORITY 1: JSON-LD SEO Bypass ───────────────────────────────────────
    const seoPrice = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (let script of scripts) {
        try {
          const data = JSON.parse(script.innerText);
          const items = Array.isArray(data) ? data : [data];
          for (let item of items) {
            if (item['@type'] === 'Product' && item.offers) {
              const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (offer && offer.price) return `₹${offer.price}`;
            }
          }
        } catch (_) {}
      }
      return null;
    });

    if (seoPrice) {
      console.log(`💰 JioMart price via JSON-LD: ${seoPrice}`);
      return seoPrice;
    }

    // ─── PRIORITY 2: Meta tag price ───────────────────────────────────────────
    const metaPrice = await page.evaluate(() => {
      const el =
        document.querySelector('meta[property="product:price:amount"]') ||
        document.querySelector('meta[itemprop="price"]') ||
        document.querySelector('meta[name="twitter:data1"]');
      if (el) {
        const val = el.getAttribute('content') || el.getAttribute('value');
        if (val && /\d/.test(val)) return `₹${val.replace(/[^\d.]/g, '')}`;
      }
      return null;
    });

    if (metaPrice) {
      console.log(`💰 JioMart price via meta tag: ${metaPrice}`);
      return metaPrice;
    }

    // ─── Diagnose page state ──────────────────────────────────────────────────
    const pageStatus = await page.evaluate(() => {
      const text = (document.body.innerText || '').toLowerCase();
      const html = document.body.innerHTML || '';
      return {
        isPincodeModal:
          text.includes('enter pin code') ||
          text.includes('enter pincode') ||
          text.includes('enable location') ||
          text.includes('select location'),
        isBlocked:
          text.includes('access denied') ||
          text.includes('captcha') ||
          text.includes('unusual traffic') ||
          text.includes('security check'),
        isUnavailable:
          text.includes('currently unavailable') ||
          text.includes('out of stock') ||
          text.includes('sold out') ||
          text.includes('page not found') ||
          text.includes("we couldn't find the page") ||
          text.includes('something went wrong'),
        hasPriceClass:
          html.includes('PriceContainer') ||
          html.includes('jm-heading-xl') ||
          html.includes('product-price'),
        bodySnippet: text.substring(0, 400),
      };
    });

    console.log(
      `🔍 Page status: pincodeModal=${pageStatus.isPincodeModal} | blocked=${pageStatus.isBlocked} | unavailable=${pageStatus.isUnavailable} | hasPriceClass=${pageStatus.hasPriceClass}`
    );
    console.log(`📝 Body snippet: ${pageStatus.bodySnippet}`);

    // ─── Step 5: If pincode modal STILL showing, interact with it directly ────
    if (pageStatus.isPincodeModal) {
      console.log('📍 Pincode modal detected on product page — attempting direct interaction...');
      try {
        // Try to find and fill pincode field on the product page itself
        await page.waitForSelector(
          'input[placeholder*="pincode" i], input[placeholder*="pin" i], input[id*="pincode" i], .pincode-input, #pincode',
          { visible: true, timeout: 5000 }
        );
        const input = await page.$(
          'input[placeholder*="pincode" i], input[placeholder*="pin" i], input[id*="pincode" i], .pincode-input, #pincode'
        );
        if (input) {
          await input.click({ clickCount: 3 });
          await input.type(PINCODE, { delay: 100 });
          await new Promise((r) => setTimeout(r, 400));
          await page.keyboard.press('Enter');
          console.log('✅ Pincode entered on product page modal');
          // Wait for page to reload with price
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (e) {
        console.log(`⚠️ Could not interact with pincode modal: ${e.message}`);
      }

      // Re-check JSON-LD after pincode entry
      const seoPrice2 = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (let script of scripts) {
          try {
            const data = JSON.parse(script.innerText);
            const items = Array.isArray(data) ? data : [data];
            for (let item of items) {
              if (item['@type'] === 'Product' && item.offers) {
                const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                if (offer && offer.price) return `₹${offer.price}`;
              }
            }
          } catch (_) {}
        }
        return null;
      });

      if (seoPrice2) {
        console.log(`💰 JioMart price via JSON-LD (post-pincode): ${seoPrice2}`);
        return seoPrice2;
      }
    }

    if (pageStatus.isBlocked) {
      console.log(`🚫 JioMart bot-detection triggered.`);
      await page.screenshot({ path: '/tmp/jiomart-blocked.png', fullPage: false });
      return null;
    }

    if (pageStatus.isUnavailable && !pageStatus.hasPriceClass) {
      console.log(`⚠️ Product genuinely unavailable on JioMart: ${url}`);
      return null;
    }

    // ─── PRIORITY 3: Wait for visual price ───────────────────────────────────
    try {
      await page.waitForSelector(
        '.PriceContainer__currentPrice, .jm-heading-xl, .product-price, [class*="currentPrice"], [class*="selling-price"]',
        { visible: true, timeout: 12000 }
      );
    } catch (e) {
      console.log('⚠️ Price selector still not visible after 12s — broad sweep next');
    }

    // ─── Visual price extraction ──────────────────────────────────────────────
    const priceText = await page.evaluate(() => {
      const extractNumber = (text) => {
        const match = text.replace(/,/g, '').match(/\d+(\.\d{1,2})?/);
        return match ? `₹${match[0]}` : null;
      };

      const isInCarousel = (el) =>
        !!(
          el.closest('.swiper-container') ||
          el.closest('.carousel') ||
          el.closest('.slick-slider') ||
          el.closest('aside') ||
          el.closest('[class*="related"]') ||
          el.closest('[class*="similar"]') ||
          el.closest('[class*="recommend"]')
        );

      let maxFontSize = 0;
      let bestPrice = null;

      // Pass 1: known price selectors
      const knownPriceEls = Array.from(
        document.querySelectorAll(
          '.PriceContainer__currentPrice, .jm-heading-xl, .product-price, .jm-heading-s, [class*="currentPrice"], [class*="selling-price"]'
        )
      );
      for (let el of knownPriceEls) {
        if (isInCarousel(el)) continue;
        if (!el.textContent?.includes('₹')) continue;
        const style = window.getComputedStyle(el);
        if (style.textDecoration.includes('line-through')) continue;
        const fontSize = parseFloat(style.fontSize) || 0;
        if (fontSize > maxFontSize) {
          const cleaned = extractNumber(el.textContent);
          if (cleaned) { maxFontSize = fontSize; bestPrice = cleaned; }
        }
      }
      if (bestPrice) return bestPrice;

      // Pass 2: broad leaf-node sweep
      for (let el of Array.from(document.querySelectorAll('*'))) {
        if (el.children.length > 0) continue;
        if (!el.textContent?.includes('₹')) continue;
        if (isInCarousel(el)) continue;
        const style = window.getComputedStyle(el);
        if (style.textDecoration.includes('line-through')) continue;
        if (el.textContent.includes('%')) continue;
        const fontSize = parseFloat(style.fontSize) || 0;
        if (fontSize > maxFontSize) {
          const cleaned = extractNumber(el.textContent);
          if (cleaned) { maxFontSize = fontSize; bestPrice = cleaned; }
        }
      }
      return bestPrice;
    });

    if (!priceText) {
      console.log(`⚠️ Could not find price visually. Taking screenshot.`);
      await page.screenshot({ path: '/tmp/jiomart-error.png', fullPage: false });
      return null;
    }

    console.log(`💰 JioMart price via visual scrape: ${priceText}`);
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