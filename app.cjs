const puppeteer = require('puppeteer')

;(async () => {
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    const response = await page.goto('http://1protocol.com', { waitUntil: 'networkidle0' })
    const chain = response.request().redirectChain().map(e => e.url());
    chain.push(response.url())
    const content = await page.content();
    console.log(content)
    chain.forEach(url => { console.log(url) })
    await page.close()
    await browser.close()
})()
