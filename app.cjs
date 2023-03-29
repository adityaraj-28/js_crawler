const puppeteer = require('puppeteer')
const CONSTANTS = require("./constants.js");

// ( async (page, domain)
// )
crawl = (async (domain, proxy=null) => {
    let page = null
    let browser = null
    try {
        let chromium_args = [
            '--lang=en-GB',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-urlfetcher-cert-requests ',
            '--ignore-certifcate-errors-spki-list',
            '--disable-extensions',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-site-isolation-trials'
        ]
        if (proxy !== null)
            chromium_args.push(`--user-agent=${CONSTANTS.USER_AGENT}`)

        browser = await puppeteer.launch({
            headless: true,
            args: chromium_args
        })
        page = await browser.newPage()
        let response = null
        try {
            response = await page.goto(domain, {waitUntil: 'networkidle0'})
            const chain = response.request().redirectChain().map(e => e.url());
            chain.push(response.url())
            const content = await page.content();
            console.log(content)
            chain.forEach(url => {
                console.log(url)
            })
        } catch (error) {
            // todo: log this error to DB
            console.log(error)
        }
    } catch(error) {
        if (page !== null)
            await page.close()
        if (browser !== null)
            await browser.close()
    }
})

crawl('https://illumin.com/')
