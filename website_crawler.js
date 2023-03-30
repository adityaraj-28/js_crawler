'use strict';
const CONSTANTS = require("./constants.js");
const playwright = require('playwright');
const url = require('url');

const ENTITY_FORMATS = CONSTANTS.ENTITY_FORMATS
const ENTITY_REGEX = CONSTANTS.ENTITY_REGEX

function redirectionChain(url, response) {
    try{
        response = response.request()
        const redirections = [response.url()];
        while (response.url() !== url) {
            response = response.redirectedFrom()
            redirections.push(response.url());
        }
        return redirections;
    }catch(error){
        console.log(error);
        return [url];
    }
}

function isValidUrl(url) {
    if(url.startsWith('#')) return false
    let invalidRegex = CONSTANTS.ENTITY_EXCLUSION
    for(let x in invalidRegex){
        if(url.includes(invalidRegex[x])){
            return false
        }
    }
    const emojiRegex = /\p{Extended_Pictographic}/ug
    return !emojiRegex.test(url);
}


function extractFromUrls(page, options) {
    return new Promise(async (resolve, reject) => {
        console.log("Processing from urls...");
        try {
            const parsed_url = url.parse(page.url())
            const base_url = `${parsed_url.protocol}//${parsed_url.hostname}`
            let domain = (new URL(page.url())).hostname.replace('www.', '');
            let entities = {}
            for (const [key, value] of Object.entries(ENTITY_FORMATS)) {
                entities[key] = [];
            }
            const elementHrefs = [...new Set(await page.$$eval('a', as => as.map(tag => tag.getAttribute('href') || '#')))];
            for (let i = 0; i < elementHrefs.length; i++) {
                console.log("Processing url: " + elementHrefs[i]);
                if(!isValidUrl(elementHrefs[i])) continue
                if(elementHrefs[i].startsWith("http")){
                    const nested_url_domain = (new URL(elementHrefs[i])).hostname.replace('www.', '');
                    if(nested_url_domain !== domain) continue
                } else {
                    elementHrefs[i] = base_url + elementHrefs[i]
                }
                console.log("valid url: " + elementHrefs[i])
            }
            resolve(entities);
        }
        catch (error) {
            reject(error);
        }
    });
}

// todo: fix this
function fetchFromClick(key, value, page) {

    return new Promise(async (resolve, reject) => {
        console.log("Processing clickables for " + key);
        try {
            const hrefs = [];
            for (let i = 0; i < ENTITY_REGEX[key].length; i++) {
                const imageCSS = 'img[alt*="' + ENTITY_REGEX[key][i] + '"]';
                let element = await page.$(imageCSS);
                if (element) {
                    try {
                        console.log("Found Image Tag, Trying to click...");
                        //click on the image element with popup
                        const [newPage] = await Promise.all([
                            page.waitForEvent('popup', { timeout: 5000 }),
                            page.click(imageCSS, { force: true, timeout: 2000 })
                        ]);
                        let pageUrl = newPage.url();
                        if (pageUrl.includes(value) && isValidUrl(pageUrl)) {
                            hrefs.push(pageUrl);
                        }
                        await newPage.close();
                    }
                    catch (error) {
                        console.log(error);
                    }
                }
            }
            resolve(hrefs);
        } catch (error) {
            reject(error);
        }
    });
}

function crawl(url, proxy, level) {
    return new Promise(async (resolve, reject) => {
        console.log('Processing url: ' + url + ' level:' + level);

        let browser = null;
        let page = null;
        let browserContext = null;
        let statusCode = 200;
        const data = {};
        try {
            const options = {
                locale: 'en-GB',
                bypassCSP: true,
                ignoreHTTPSErrors: true,
                userAgent: CONSTANTS.USER_AGENT,
                proxy: proxy,
                headless: true
            }
            browser = await playwright.chromium.launch(options);

            browserContext = await browser.newContext();
            page = await browser.newPage(options);
            let response;
            try {
                response = await page.goto(url, {waitUntil: "networkidle", timeout: 20000 });
            }catch(error){
                response = await page.waitForResponse(response => response.status() === 200)
                console.log(error);
            }
            statusCode = response.status();
            if (statusCode !== 200) throw new Error(`${statusCode}`);

            await page.on('dialog', async (dialog) => {
                await dialog.dismiss();
            });

            const chain = redirectionChain((new URL(url)).href, response);
            console.log("Generated Chain: ", chain);

            let entities = {};
            await Promise.all([
                await extractFromUrls(page, options)
            ]).then(async (data) => {
                entities = data[0];
                for (const [key, value] of Object.entries(ENTITY_FORMATS)) {
                    if (entities[key].length === 0) {
                        await Promise.all(
                            await fetchFromClick(key, value, page)
                        ).then((hrefs) => {
                            entities[key] = [...new Set(hrefs)];
                        }).catch((message) => {
                            console.log(message);
                        })
                    }
                    else {
                        entities[key] = [...new Set(entities[key])];
                    }
                }
            }).catch((message) => {
                console.log(message);
            })

            //modify entities
            entities['app_store'] = [...new Set(entities['app_store'].concat(entities['apple_store']))];
            entities['youtube'] = [...new Set(entities['youtube'].concat(entities['youtube_user']))];
            delete entities['apple_store'];
            delete entities['youtube_user'];
            console.log(entities);

            data['domain'] = (new URL(page.url())).hostname.replace('www.', '');
            data['response'] = await page.content();
            data['redirection_chain'] = [...new Set(chain)];
            data['entities'] = entities

            resolve(data);

        } catch (error) {
            statusCode = Number(error.message);
            console.log(error);
            reject(statusCode);
        } finally {
            if (page !== null) {
                await page.close();
            }
            if (browserContext !== null) {
                await browserContext.close();
            }
            if (browser !== null) {
                await browser.close();
            }
        }
    });
}

function processUrl(domain, proxy, level) {
    return new Promise(async (resolve, reject) => {
        await Promise.all([
            crawl('https://' + domain, proxy, level)
        ]).then((response) => {
            resolve(response[0]);
        }).catch(async (status) => {
            await Promise.all([
                crawl('http://' + domain, proxy, level)
            ]).then((response) => {
                console.log("response[0] :" + response[0])
                resolve(response[0]);
            }).catch((status) => {
                reject(status);
            })
        });
    });
}
function cleanDomain(domain){
    let protocols = CONSTANTS.PROTOCOLS
    for(let x in protocols){
        domain = domain.replace(protocols[x], '')
    }
    return domain
}
module.exports.main = async (event, context, callback) => {
    const proxy = event.body["proxy"];
    const level = context["level"]
    let statusCode = 200;
    let data = {};
    const raw_url = event.body["raw_url"]
    if(level === 0) {
        // for level 0 raw url is domain
        const domain = cleanDomain(raw_url);
        await Promise.all([
            processUrl('www.' + domain, proxy, level)
        ]).then((response) => {
            data = response[0];
        }).catch(async (status) => {
            await Promise.all([
                processUrl(domain, proxy, level)
            ]).then((response) => {
                data = response[0];
                console.log(data)
            }).catch((status) => {
                statusCode = status;
            })
        });
    } else if (level <= CONSTANTS.LEVEL_LIMIT){
        // for next level dont clean, dont process
        await Promise.all([
            crawl(raw_url, proxy, level)
        ]).then((response) => {
            data = response[0];
            console.log(data)
        }).catch((status) => {
            statusCode = status;
        })
    }

    const response = {
        statusCode: statusCode? statusCode : 503,
        headers: {
            'Content-Type': 'text/plain'
        },
        body: data
    };
    callback(null, response);
};
