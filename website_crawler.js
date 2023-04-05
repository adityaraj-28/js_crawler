'use strict';
const CONSTANTS = require("./constants.js");
const playwright = require('playwright');
const db = require('./db')
const _url = require('url');
const isValidDomain = require('is-valid-domain')
const fs =require('fs')
const  { writePageContentToS3 } = require('./s3.js')
const path = require('path')


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
    const ext = path.extname(url)
    if(ext !== '' && ext !== '.html' && ext !== '.htm')
        return false
    const emojiRegex = /\p{Extended_Pictographic}/ug
    return !emojiRegex.test(url);
}

function getDomain(url) {
    console.log("getDomain url: " + url)
    let domain
    try {
        domain = (new URL(url)).hostname.replace('www.', '');
        console.log("domain set " + domain)
    } catch(err){
        if(isValidDomain(url)) {
            domain = url
            console.log("domain set after err " + domain)
        } else {
            console.log("err thrown from getDomain")
            throw err
        }
    }
    return domain
}

function getDomainUrls(domain) {
    console.log("in get domain urls")
    return new Promise(async (resolve, reject) => {
        console.log('domain to fetch urls: ' + domain)
        const query = `select id, domain, url, status from crawl_status_2 where domain='${domain}'`
        console.log("get domain query " + query)
        db.query(query, (error, results, _) => {
            if (error) {
                console.log(`getDomainUrl: ${error.message}`)
                reject(error)
            } else {
                const url_status_map = new Map()
                results.forEach(function(row) {
                    console.log(row.url, row.status)
                    url_status_map.set(row.url, {
                        status: row.status,
                        id: row.id
                    });
                });
                resolve(url_status_map)
            }
        });
    });
}


// used for testing purpose
function writeAsJson(data) {
    return new Promise(async (resolve, reject) => {
        fs.writeFile('out.json', JSON.stringify(data), err => {
            if(err){
                reject(err)
            }
            console.log('written to json')
            resolve()
        })
    });
}

function handleMapping(url_status_map, url, domain, level, status) {
    console.log('in handle mapping printing map')
    console.log('url: '+ url + ' map has ' + url_status_map.has(url))
    if(url_status_map.has(url)) {
        console.log('here in url_status_map.has(url)')
        console.log('check instance' + (url_status_map instanceof Map))
        const value = url_status_map.get(url)
        console.log('value_status ' + value.status + 'id ' + value.id)
        if(value.status === 0 && status === true) {
            const update_query = `update crawl_status_2 set status=true where domain='${domain}' and url='${url}'`
            console.log('update_query'+ update_query)
            db.query(update_query)
        } else {
            console.log(`url ${url} already crawled`)
        }
        return value.id
    } else {
        db.query(`insert into crawl_status_2 (domain, url, level, status) values ('${domain}', '${url}', ${level}, ${status})`, (err, res) => {
            if(err){
                throw new Error(err.message)
            } else {
                return res.insertId
            }
        })
    }
}

function extractUrls(page, url_status_map, level) {
    return new Promise(async (resolve, reject) => {
        console.log("Processing from urls...");
        try {
            const parsed_url = _url.parse(page.url())
            const base_url = `${parsed_url.protocol}//${parsed_url.hostname}`
            let domain = getDomain(page.url())

            const elementHrefs = [...new Set(await page.$$eval('a', as => as.map(tag => {
                let attr = tag.getAttribute('href')
                const hash_index = attr.indexOf('#')
                if(hash_index !== -1){
                    attr = attr.substring(0, hash_index)
                }
                return attr
            }).filter(href => href !== '/' && href !== '')))];
            // todo: remove limit
            for (let i = 0; i < elementHrefs.length; i++) {
                console.log("Processing url: " + elementHrefs[i]);
                if(elementHrefs[i].startsWith("http")){
                    const nested_url_domain = (new URL(elementHrefs[i])).hostname.replace('www.', '');
                    if(nested_url_domain !== domain) continue
                } else {
                    elementHrefs[i] = base_url + elementHrefs[i]
                }
                if(!isValidUrl(elementHrefs[i]) || elementHrefs[i] === page.url()) continue
                console.log("valid url: " + elementHrefs[i])
                handleMapping(url_status_map, elementHrefs[i], domain, level+1, false)
            }
            resolve("Extracted urls")
        }
        catch (error) {
            reject(error);
        }
    });
}

function crawl(url, proxy, level, url_status_map) {
    return new Promise(async (resolve, reject) => {
        console.log('Processing url: ' + url + ' level:' + level);

        let browser = null;
        let page = null;
        let browserContext = null;
        let statusCode = 200;
        const data = {};
        const domain = getDomain(url)
        console.log('printing keys crawl: ')
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

            url = page.url()

            if(url_status_map.has(url) && url_status_map.get(url).status === true){
                console.log('Page already processed')
                reject('Page already processed')
                return
            }

            const chain = redirectionChain((new URL(url)).href, response);
            console.log("Generated Chain: ", chain);

            await Promise.all([
                await extractUrls(page, url_status_map, level)
            ]).catch((message) => {
                console.log(message);
            })

            const insertId = handleMapping(url_status_map, url, domain, level, true)
            console.log('insert id : ' + insertId)
            data['domain'] = domain;
            data['url'] = url;
            data['response'] = await page.content();
            data['redirection_chain'] = [...new Set(chain)];

            await Promise.all([
                await writeAsJson(data)
                // await writePageContentToS3(JSON.stringify(data), domain, level, `${insertId}_${new Date().toISOString()}.json`)
            ]).then((msg) => {
                console.log('saved to s3')
            }).catch((err) => {
                console.log(err);
            })

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

function processUrl(domain, proxy, level, url_status_map) {
    return new Promise(async (resolve, reject) => {
        await Promise.all([
            await crawl('https://' + domain, proxy, level, url_status_map)
        ]).then((response) => {
            resolve(response[0]);
        }).catch(async (status) => {
            await Promise.all([
                crawl('http://' + domain, proxy, level, url_status_map)
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
    const domain = getDomain(raw_url)
    console.log("crawler input: " + domain, raw_url, level);
    console.log('fetching urls for domain in main')
    const url_status_map = await getDomainUrls(domain)
    console.log("fetched url status map")
    for (const [url, { id, status }] of url_status_map.entries()) {
        console.log(`main URL: ${url}, URL ID: ${id}, Status: ${status}`);
    }

    if(url_status_map.has(raw_url) && url_status_map.get(raw_url).status === true) {
        callback('Url already processed', {
            statusCode: 403,
            headers: {
                'Content-Type': 'text/plain'
            },
            body: 'Url already processed'
        });
        return
    }
    // check if domain is invalid
    if(domain.startsWith('mailto:')) {
        callback('Invalid Url', null)
        return
    }
    if(level === 0) {
        // for level 0 raw url is domain
        const domain = await cleanDomain(raw_url);
        console.log('domain name ' + domain)
        await Promise.all([
            await processUrl('www.' + domain, proxy, level, url_status_map)
        ]).then((response) => {
            data = response[0];
        }).catch(async (status) => {
            await Promise.all([
                await processUrl(domain, proxy, level, url_status_map)
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
            await crawl(raw_url, proxy, level, url_status_map)
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
    if(response.statusCode === 503)
        callback(response, null)
    else
        callback(null, response);
};

module.exports = {
    website_crawler: module.exports.main
}