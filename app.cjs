const puppeteer = require('puppeteer')
const { Events } = require('puppeteer')
const { PuppeteerWARCGenerator, PuppeteerCapturer } = require('node-warc')

;(async () => {
    const browser = await puppeteer.launch({headless: false})
    const page = await browser.newPage()
    const cap = new PuppeteerCapturer(page)
    cap.startCapturing()
    await page.goto('https://twitter.com', { waitUntil: 'networkidle0' })
    const warcGen = new PuppeteerWARCGenerator()
    await warcGen.generateWARC(cap, {
        warcOpts: {
            warcPath: 'myWARC.warc'
        },
        winfo: {
            description: 'I created a warc!',
            isPartOf: 'My awesome pywb collection'
        }
    })
    await page.close()
    await browser.close()
})()