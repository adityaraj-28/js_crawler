'use strict';
const CONSTANTS = require("./constants.js");
const playwright = require('playwright');
const db = require('./db')
const _url = require('url');
const fs =require('fs')
const  { writePageContentToS3 } = require('./s3.js')
const path = require('path')
const log = require('./logger');
const https = require('https')

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
function isContentTypeValid(contentType) {
    if(contentType == null) return true
    const type = (contentType.split('/'))[0].trim()
    return type === 'application' || type === 'text';


}
function isValidUrl(url) {
    if(url.startsWith('#')) return false
    if(!url.startsWith('http')) return false
    const emojiRegex = /\p{Extended_Pictographic}/ug
    return !emojiRegex.test(url);
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
    log.info(`Handling DB mapping for domain: ${domain}, url:${url}`)
    if(url_status_map.has(url)) {
        const value = url_status_map.get(url)
        if(value.status !== 1 && status === 1) {
            const update_query = `update crawl_status_2 set log=NULL, status=1, redirection_chain='${chain}' where id=${value.id}`
            log.info('DB query'+ update_query)
            db.query(update_query)
        } else {
            if(value.status === 1) {
                log.info(`url ${url} already crawled`)
                throw Error('URL already crawled')
            }
        }
        return value.id
    } else {
        let query = `insert into crawl_status_2 (domain, url, level, status) values ('${domain}', '${url}', ${level}, ${status})`
        if(chain) {
            query = `insert into crawl_status_2 (domain, url, level, status, redirection_chain) values ('${domain}', '${url}', ${level}, ${status}, '${chain}')`
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
            let valid_link_count = 0
            for (let i = 0; i < elementHrefs.length; i++) {
                if(elementHrefs[i].startsWith("http")){
                    const nested_url_domain = (new URL(elementHrefs[i])).hostname.split('.').slice(-2).join('.')
                    if(nested_url_domain !== domain) continue
                } else {
                    elementHrefs[i] = _url.resolve(base_url, elementHrefs[i])
                }
                if(!isValidUrl(elementHrefs[i]) || elementHrefs[i] === page.url()) continue
                elementHrefs[i] = addSlashInUrl(elementHrefs[i])
                if(url_status_map.has(elementHrefs[i])) continue
                valid_link_count++
                // todo: remove this in staging
                if(valid_link_count > 3) break
                log.info("valid url: " + elementHrefs[i])
                try {
                    await handleMapping(url_status_map, elementHrefs[i], domain, level + 1, 0)
                } catch(err){
                    log.error(`handle mapping error, url: ${page.url()}, ${err}`)
                }

            }
            resolve("Extracted urls")
        }
        catch (error) {
            log.error(error)
            const query = `update crawl_status_2 set status=-1, log='${error.name}' where domain='${domain}' and url='${page.url()}'`
            db.query(query, (err, result, fields) => {
                if(err)
                    log.error(`${query}, error: ${err.toString().slice(0, 800)}`)
                else
                    log.info(`${query} success`)
            })
            reject(error);
        }
    });
}

function downloadImages(page, url, domain) {
    return new Promise(async (resolve, reject) => {
        try {
            const imgElements = await page.$$('img');
            for (const imgElement of imgElements) {
                const imageUrl = await imgElement.getAttribute('src');
                const filename = `${domain}_${path.basename(imageUrl)}`;
                https.get(imageUrl, { timeout: 5000}, (response) => {
                    response.pipe(fs.createWriteStream(filename));
                }).on('error', (err) => {
                    console.error(`error downloading image ${imageUrl}, ${err}`);
                });
            }
        } catch(err){
            log.error(`error to fetch img tags, url: ${url}, ${err}`)
            reject(`Image Download failed for ${url}`)
            return
        }
        resolve(`Downloaded images for ${url}`)
    })
}

function crawl(url, proxy, level, url_status_map, domain) {
    return new Promise(async (resolve, reject) => {
        url = addSlashInUrl(url)
        log.info('Processing url: ' + url + ' level:' + level);

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
                response = await page.waitForResponse(response => response.status() === 200, { timeout: 20000})
                log.error(`for url: ${url}, error: ${error}`);
            }
            statusCode = response.status();

            if(statusCode === 404) {
                const url_end_slash_removed = url.slice(0,-1)
                try {
                    response = await page.goto(url_end_slash_removed, {waitUntil: "networkidle", timeout: 20000 });
                } catch(error){
                    response = await page.waitForResponse(response => response.status() === 200, { timeout: 20000})
                    log.error(`for url: ${url_end_slash_removed}, error: ${error}`);
                }
            }
            statusCode = response.status();
            if (statusCode !== 200) throw new Error(`${statusCode}`);

            const contentType = response.headers()['content-type']
            if(!isContentTypeValid(contentType)) {
                throw new Error(`response url ${page.url()}, content type: ${contentType} invalid`)
            }

            if(url_status_map.has(url) && url_status_map.get(url).status === true){
                log.info(`Page ${url} already processed`)
                reject('Page already processed')
                return
            }

            await downloadImages(page, url, domain).then(res => log.info(res)).catch(err => log.error(err))

            const chain = redirectionChain((new URL(url)).href, response);
            chain.reverse()
            log.info("Generated Chain: ", chain.join(','));

            const insertId = await handleMapping(url_status_map, url, domain, level, 1, '[' + chain.join(', ') + ']')
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
                // await writeAsJson(data['response'], filename, domain)
                await writePageContentToS3(data['response'], domain, url, filename)
            ]).then((msg) => {
                log.info(`saving html for ${url} to s3`)
            }).catch((err) => {
                const query = `update crawl_status_2 set status=-1, log='${err}' where domain='${domain}' and url='${url}'`
                db.query(query, (err, result, fields) => {
                    if(err){
                        log.error(`${query}, error: ${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
                log.error(err);
            })


            await Promise.all([
                await extractUrls(page, url_status_map, level, domain)
            ]).catch((message) => {
                log.error(message);
            })

            resolve(data);
        } catch (error) {
            log.error(`error in crawl, url: ${url}, ${error}`);
            if(url_status_map.has(url) && error.message !== 'URL already crawled') {
                const query = `update crawl_status_2 set status=-1, log='${error.toString().slice(0, 800)}' where domain='${domain}' and url='${url}'`;
                db.query(query, (err, result, fields) => {
                    if(err){
                        log.error(`${query}, error: ${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
            }
            else if(!url_status_map.has(url)){
                const query = `insert into crawl_status_2 (domain, url, level, status, log) values ('${domain}', '${url}', ${level}, -1, log='${error.toString().slice(0, 800)}')`
                db.query(query, (err, result, fields) => {
                    if(err){
                        log.error(`${query}, error: ${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
            }
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
            crawl('https://' + domain, proxy, level, url_status_map, domain.replace('www.',''))
        ]).then((response) => {
            resolve(response[0]);
        }).catch(async (status) => {
            await Promise.all([
                crawl('http://' + domain, proxy, level, url_status_map, domain.replace('www.',''))
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
async function website_crawler (event, url_status_map, callback) {
    const proxy = event.body["proxy"];
    const level = event.body["level"];
    const url = event.body["url"]
    let domain = event.body["domain"]
    let statusCode = 200;
    let data = {};
    log.info(`Running crawler for domain:${domain}, url:${url}, level:${level}`)
    log.info("fetched url status map")

    if(url_status_map.has(url) && url_status_map.get(url).status === 1) {
        callback('Url already processed', {
            statusCode: 403,
            headers: {
                'Content-Type': 'text/plain'
            },
            body: 'Url already processed'
        });
        return
    }

    if(level === 0 && domain != null) {
        domain = await cleanDomain(domain);
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
            crawl(url, proxy, level, url_status_map, domain)
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

function website_crawler_sync(event, url_status_map) {
    return new Promise((resolve, reject) => {
        website_crawler(event, url_status_map, (err, res) => {
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