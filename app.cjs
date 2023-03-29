const puppeteer = require('puppeteer')
const CONSTANTS = require("./constants.js");

formUrlAndCall = (async (page, domain) => {
    let response = null
    for (const protocol of CONSTANTS.PROTOCOLS) {
        try {
            response = await page.goto(domain, {waitUntil: 'networkidle0', timeout: 15000})
            if(response.status === 200){
                break
            }
        } catch(e) {
            if(e instanceof puppeteer.TimeoutError){
                console.log('Retrying with other protocol')
            }
        }
    }
    if (!domain.startsWith('www.') && response === null){
        response = await formUrlAndCall(page, `www.${domain}`)
    }
    return response
    // e instanceof puppeteer.TimeoutError
})
crawl = (async (domain, proxy=null) => {
    let page = null
    let browser = null
    // try {
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
            response = await formUrlAndCall(page, domain)
            const chain = response.request().redirectChain().map(e => e.url());
            chain.push(response.url())
            const content = await page.content();
            console.log(content)
            chain.forEach(url => {
                console.log(url)
            })
        } catch (e) {
            // todo: log this error to DB
            console.log(e)
        }
    // } catch(error) {
    //     console.log(error)
    // }
    if (page !== null)
    await page.close()
    if (browser !== null)
        await browser.close()
})

crawl('https://100marke435345ts.com/')
