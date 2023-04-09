'use strict';
const CONSTANTS = require("./constants.js");
const playwright = require('playwright');
const db = require('./db')
const _url = require('url');
const isValidDomain = require('is-valid-domain')
const fs =require('fs')
const  { writePageContentToS3 } = require('./s3.js')
const path = require('path')
const log = require('./logger');

function addSlashInUrl(url){
    if(url[url.length - 1] !== '/'){
        url = url + '/'
    }
    return url
}
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
        log.error('redirection chain generation error' + error);
        return [url];
    }
}

function isValidUrl(url) {
    if(url.startsWith('#')) return false
    if(!url.startsWith('http')) return false
    const ext = path.extname(url)
    if(ext !== '' && ext !== '.html' && ext !== '.htm')
        return false
    const emojiRegex = /\p{Extended_Pictographic}/ug
    return !emojiRegex.test(url);
}

function getDomain(url) {
    let domain
    try {
        domain = (new URL(url)).hostname.replace('www.', '');
    } catch(err){
        if(isValidDomain(url)) {
            domain = url
        } else {
            log.error("getDomain error " + err)
            throw err
        }
    }
    return domain
}

function getDomainUrls(domain) {
    log.info(`Fetching urls for domain: ${domain}`)
    return new Promise(async (resolve, reject) => {
        const query = `select id, domain, url, status from crawl_status where domain='${domain}'`
        log.info('')
        db.query(query, (error, results, _) => {
            log.info(`executing query: ${query}`)
            if (error) {
                log.error(`getDomainUrl: ${error.message}`)
                reject(error)
            } else {
                const url_status_map = new Map()
                results.forEach(function(row) {
                    if(!url_status_map.has(row.url) || (url_status_map.has(row.url) && url_status_map.get(row.url).status === 0)){
                        url_status_map.set(row.url, {
                            status: row.status,
                            id: row.id
                        });
                    }
                });
                resolve(url_status_map)
            }
        });
    });
}


// used for testing purpose
function writeAsJson(data, filename, domain) {
    const directory = `./data/${domain}`
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }
    return new Promise(async (resolve, reject) => {
        fs.writeFile(`${directory}/${filename}`, JSON.stringify(data), err => {
            if(err){
                reject(err)
            }
            log.info('written to json')
            resolve()
        })
    });
}

async function handleMapping(url_status_map, url, domain, level, status, chain=null) {
    log.info(`Handling DB mapping for domain:${domain}, url:${url}`)
    if(url_status_map.has(url)) {
        const value = url_status_map.get(url)
        if(value.status === 0 && status === true) {
            const update_query = `update crawl_status set status=true, redirection_chain='${chain}' where id=${value.id}`
            log.info('DB query'+ update_query)
            db.query(update_query)
        } else {
            if(value.status !== 0) {
                log.info(`url ${url} already crawled`)
                throw Error('URL already crawled')
            }
        }
        return value.id
    } else {
        let query = `insert into crawl_status (domain, url, level, status) values ('${domain}', '${url}', ${level}, ${status})`
        if(chain) {
            query = `insert into crawl_status (domain, url, level, status, redirection_chain) values ('${domain}', '${url}', ${level}, ${status}, '${chain}')`
        }
        log.info(`DB query: ${query}`)
        db.query(query, (err, res) => {
            if(err){
                log.error(`Error inserting to DB, url: ${url} : ${err.message}`)
                throw new Error(err.message)
            }
            return res.insertId
        })
    }
}

function extractUrls(page, url_status_map, level, domain) {
    return new Promise(async (resolve, reject) => {
        log.info(`Extracting urls from ${page.url()}`);
        try {
            const parsed_url = _url.parse(page.url())
            const base_url = `${parsed_url.protocol}//${parsed_url.hostname}`
            const elementHrefs = [...new Set(await page.$$eval('a', as => as.map(tag => {
                let attr = tag.getAttribute('href')
                if(attr === null){
                    return ''
                }
                console.log('attr: ' + attr)
                const hash_index = attr.indexOf('#')
                if(hash_index !== -1){
                    attr = attr.substring(0, hash_index)
                }
                return attr
            }).filter(href => {
                if(href === '/' || href === '') return false
                return !['ftp://', 'mailto:', 'tel:', 'sms:', 'data:', 'javascript:'].some(prefix => href.startsWith(prefix));

            })))]
            for (let i = 0; i < elementHrefs.length; i++) {
                if(elementHrefs[i].startsWith("http")){
                    const nested_url_domain = (new URL(elementHrefs[i])).hostname.replace('www.', '');
                    if(nested_url_domain !== domain) continue
                } else {
                    elementHrefs[i] = _url.resolve(base_url, elementHrefs[i])
                }
                if(!isValidUrl(elementHrefs[i]) || elementHrefs[i] === page.url()) continue
                elementHrefs[i] = addSlashInUrl(elementHrefs[i])
                log.info("valid url: " + elementHrefs[i])
                try {
                    await handleMapping(url_status_map, elementHrefs[i], domain, level + 1, false)
                } catch(err){
                    log.error(`handle mapping error, url: ${page.url()}, ${err}`)
                }

            }
            resolve("Extracted urls")
        }
        catch (error) {
            log.error(error)
            db.query(`update crawl_status set log='${error.name}' where domain='${domain}' and url='${page.url()}'`)
            reject(error);
        }
    });
}

function crawl(url, proxy, level, url_status_map) {
    return new Promise(async (resolve, reject) => {
        url = addSlashInUrl(url)
        log.info('Processing url: ' + url + ' level:' + level);

        let browser = null;
        let page = null;
        let browserContext = null;
        let statusCode = 200;
        const data = {};
        const domain = getDomain(url)
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
                response = await page.waitForResponse(response => response.status() === 200, { timeout: 20000})
                log.error(`for url: ${url}, error: ${error}`);
            }
            statusCode = response.status();
            if (statusCode !== 200) throw new Error(`${statusCode}`);

            url = addSlashInUrl(url)

            if(url_status_map.has(url) && url_status_map.get(url).status === true){
                log.info(`Page ${url} already processed`)
                reject('Page already processed')
                return
            }

            const chain = redirectionChain((new URL(url)).href, response);
            chain.reverse()
            log.info("Generated Chain: ", chain);

            await Promise.all([
                await extractUrls(page, url_status_map, level, domain)
            ]).catch((message) => {
                log.error(message);
            })

            const insertId = await handleMapping(url_status_map, url, domain, level, true, '[' + chain.join(', ') + ']')
            data['domain'] = domain;
            data['url'] = url;
            data['response'] = await page.content();
            data['redirection_chain'] = chain

            let filename
            if(insertId){
                filename = `${domain}_${insertId}_${new Date().toISOString()}.txt`
            } else {
                filename = `${domain}_${new Date().toISOString()}.txt`
            }
            await Promise.all([
                await writeAsJson(data['response'], filename, domain)
                // await writePageContentToS3(data['response'], domain, url, filename)
            ]).then((msg) => {
                log.info(`saving html for ${url} to s3`)
            }).catch((err) => {
                db.query(`update crawl_status set log='${err}' where domain='${domain}' and url='${url}'`)
                log.error(err);
            })

            resolve(data);

        } catch (error) {
            log.error(`error in crawl, url: ${url}, ${error}`);
            reject(error.message);
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
            crawl('https://' + domain, proxy, level, url_status_map)
        ]).then((response) => {
            resolve(response[0]);
        }).catch(async (status) => {
            await Promise.all([
                crawl('http://' + domain, proxy, level, url_status_map)
            ]).then((response) => {
                resolve(response[0]);
            }).catch((status) => {
                log.error(`Process Url error: ${status}`)
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
async function website_crawler (event, context, callback) {
    const proxy = event.body["proxy"];
    const level = context["level"]
    let statusCode = 200;
    let data = {};
    const raw_url = event.body["raw_url"]
    const domain = getDomain(raw_url)
    log.info(`Running crawler for domain:${domain}, url:${raw_url}, level:${level}`)
    const url_status_map = await getDomainUrls(domain)
    log.info("fetched url status map")

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

    if(level === 0) {
        // for level 0 raw url is domain
        const domain = await cleanDomain(raw_url);
        await Promise.all([
            processUrl('www.' + domain, proxy, level, url_status_map)
        ]).then((response) => {
            data = response[0];
        }).catch(async (status) => {
            Promise.all([
                processUrl(domain, proxy, level, url_status_map)
            ]).then((response) => {
                data = response[0];
            }).catch((status) => {
                log.error('website crawler error: ' + status)
                statusCode = status;
            })
        });
    } else if (level <= CONSTANTS.LEVEL_LIMIT){
        // for next level dont clean, dont process
        await Promise.all([
            crawl(raw_url, proxy, level, url_status_map)
        ]).then((response) => {
            data = response[0];
        }).catch((status) => {
            log.error('website crawler error: ' + status)
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
}

function website_crawler_sync(event, context) {
    return new Promise((resolve, reject) => {
        website_crawler(event, context, (err, res) => {
            if (err) {
                log.error('website_crawler_sync error' + err)
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

module.exports = website_crawler_sync