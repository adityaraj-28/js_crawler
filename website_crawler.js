'use strict';
const CONSTANTS = require("./constants.js");
const playwright = require('playwright');
const {db, queryCountInc, queryCountDec} = require("./db");
const _url = require('url');
const fs =require('fs')
const  { writePageContentToS3, uploadDocumentToS3 } = require('./s3.js')
const path = require('path')
const log = require('./logger');
const {CRAWL_STATUS} = require("./constants");
const RetryStrategies = require("requestretry/strategies");
const request = require('requestretry').defaults({
    json: true,
    retryStrategy: RetryStrategies.HTTPOrNetworkError,
    maxAttempts: 3,
    retryDelay: 3000,
})

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
            const update_query = `update ${CRAWL_STATUS} set log=NULL,status=1,redirection_chain='${chain}' where id=${value.id}`
            log.info('DB query'+ update_query)
            queryCountInc()
            db.query(update_query, () => queryCountDec())
        } else {
            if(value.status === 1) {
                log.info(`url ${url} already crawled`)
                throw Error('URL already crawled')
            }
        }
        return value.id
    } else {
        let query = `insert into ${CRAWL_STATUS} (domain, url, level, status) values ('${domain}', '${url}', ${level}, ${status})`
        if(chain) {
            query = `insert into ${CRAWL_STATUS} (domain, url, level, status, redirection_chain) values ('${domain}', '${url}', ${level}, ${status}, '${chain}')`
        }
        log.info(`DB query: ${query}`)
        queryCountInc()
        db.query(query, (err, res) => {
            queryCountDec()
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
                const hash_index = attr.indexOf('#')
                if(hash_index !== -1){
                    attr = attr.substring(0, hash_index)
                }
                return attr
            }).filter(href => {
                if(href === '/' || href === '') return false
                return !['ftp://', 'mailto:', 'tel:', 'sms:', 'data:', 'javascript:'].some(prefix => href.startsWith(prefix));

            })))]
            const validLinkSet = new Set()
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
                if(validLinkSet.has(elementHrefs[i])) continue
                else validLinkSet.add(elementHrefs[i])
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
            const query = `update ${CRAWL_STATUS} set status=-1,log="${error.name}" where domain='${domain}' and url='${page.url()}'`
            queryCountInc()
            db.query(query, (err, result, fields) => {
                queryCountDec()
                if(err)
                    log.error(`${query}, error: ${err.toString().slice(0, 800)}`)
                else
                    log.info(`${query} success`)
            })
            reject(error);
        }
    });
}

function downloadImages(page, insertId, url, domain, downloaded_filenames) {
    return new Promise(async (resolve, reject) => {
        try {
            const imgElements = await page.$$('img');
            const imageUrlSet = new Set()
            for (const imgElement of imgElements) {
                let imageUrl = await imgElement.getAttribute('src');
                if(imageUrlSet.has(imageUrl))
                    continue
                else
                    imageUrlSet.add(imageUrl)

                if(imageUrl === "" || imageUrl == null) continue
                imageUrl = new URL(imageUrl, page.url()).href
                try {
                    let filename = path.basename(imageUrl);
                    filename = augment_image_name(filename)
                    let filename_to_save = filename
                    if(downloaded_filenames.has(filename)){
                        filename_to_save = `${downloaded_filenames.get(filename)}_${filename}`
                    }
                    request.get({url: imageUrl, timeout: 5000}, (err, response, _) => {
                        queryCountInc()
                        if(err)  {
                            log.error(`Error downloading image ${imageUrl}, for ${url}, ${err}`)
                        } else {
                            let chunks = [];
                            response.on('data', (chunk) => {
                                chunks.push(chunk);
                            });
                            response.on('end', () => {
                                const buffer = Buffer.concat(chunks);
                                if(filename_to_save === filename){
                                    downloaded_filenames.set(filename, 1)
                                } else {
                                    downloaded_filenames.set(filename, downloaded_filenames.get(filename) + 1)
                                }
                                uploadDocumentToS3(buffer, filename, domain, url, insertId)
                                log.info(`Image downloaded ${imageUrl} from ${url}`)
                            });
                        }
                        queryCountDec()
                    })
                } catch(err) {
                    log.error(`Error downloading image ${imageUrl}, for ${url}, ${err}`)
                }
            }
        } catch(err){
            log.error(`error to fetch img tags, url: ${url}, ${err}`)
            reject(`Image Download failed for ${url}`)
            return
        }
        resolve()
    })
}

function augment_image_name(filename) {
    if (filename.indexOf('?') !== -1) {
        filename = filename.slice(0, filename.indexOf('?'))
    }
    const ext = ((filename.split('.'))).slice(-1)[0]
    if (ext == null || !CONSTANTS.IMAGE_EXTENSION.includes(ext))
        filename = filename + '.png'
    return filename;
}

function fileTypeIsADownloadable(url) {
    if(url.indexOf('?') !== -1){
        url = url.slice(0, url.indexOf('?'))
    }
    if(url.slice(-1) === '/') {
        url = url.slice(0, -1)
    }
    const ext = url.split('.').slice(-1)[0]
    return CONSTANTS.VALID_DOWNLOADABLE_EXTENSIONS.includes(ext)
}

function handleIdAndDocumentUpload(domain, url, buffer, filename) {
    queryCountInc()
    db.query(`select id from ${CRAWL_STATUS} where domain="${domain}" and url="${url}"`, (err, res, fields) => {
        queryCountDec()
        if (err) {
            log.error(`error fetching id, domain:${domain}, url: ${url}, error: ${err}`)
        } else {
            try {
                let insertId = null
                if (res && res[0] && res[0].id) {
                    insertId = res[0].id
                }
                uploadDocumentToS3(buffer, filename, domain, url, insertId)
            } catch (err) {
                log.error(err)
            }
        }
    })
}

function crawl(url, proxy, level, url_status_map, domain) {
    return new Promise(async (resolve, reject) => {
        // no multiple entries in db for same url (basically url ending with and without slash should be treated same
        url = addSlashInUrl(url)
        log.info('Processing url: ' + url + ' level:' + level);

        let browser = null;
        let page = null;
        let statusCode = null;
        const data = {};
        try {
            const options = {
                locale: 'en-GB',
                bypassCSP: true,
                ignoreHTTPSErrors: true,
                userAgent: CONSTANTS.USER_AGENT,
                proxy: proxy,
                headless: true,
                rejectUnauthorized: false
            }
            browser = await playwright.chromium.launch(options);

            page = await browser.newPage(options);
            let response = null;
            const downloaded_filenames = new Map()
            page.on('response', async response => {
                    const res_url = response.url()
                    try {
                        const contentType = response.headers()['content-type']
                        let temp_url = res_url
                        if (res_url && res_url.length > 1 && res_url.at(-1) === '/') {
                            temp_url = res_url.slice(0, -1)
                        }

                        if (contentType != null && contentType.startsWith('image/') && !contentType.startsWith("image/gif")) {
                            log.info(`valid image url: ${res_url}`)
                            const buffer = await response.body()
                            let filename = `${path.basename(temp_url)}`
                            filename = augment_image_name(filename);
                            if(downloaded_filenames.has(filename)) {
                                handleIdAndDocumentUpload(domain, url, buffer, `${downloaded_filenames.get(filename)}_${filename}`);
                                downloaded_filenames.set(filename, downloaded_filenames.get(filename) + 1)
                            } else {
                                handleIdAndDocumentUpload(domain, url, buffer, filename);
                                downloaded_filenames.set(filename, 1)
                            }

                        }
                    } catch (err) {
                        log.error(`url: ${url}, resource-url:${res_url}, err: ${err}`)
                    }
                }
            );

            page.on('download', download => {
                const url = download.url()
                if (fileTypeIsADownloadable(url)) {
                    const filename = download.suggestedFilename();
                    request.get({url: url, encoding: null}, (err, response, body) => {
                        if(err) {
                            log.error(`Error downloading domain: ${domain}, url: ${url}`)
                        } else {
                            const buffer = Buffer.from(body)
                            if(downloaded_filenames.has(filename)) {
                                handleIdAndDocumentUpload(domain, url, buffer, `${downloaded_filenames.get(filename)}_${filename}`);
                                downloaded_filenames.set(filename, downloaded_filenames.get(filename) + 1)
                            } else {
                                handleIdAndDocumentUpload(domain, url, buffer, filename);
                                downloaded_filenames.set(filename, 1)
                            }
                        }
                    })
                }
            })

            try {
                queryCountInc()
                response = await page.goto(url, {waitUntil: "networkidle", timeout: 20000 });
                queryCountDec()
            } catch(error){
                queryCountDec()
                try {
                    queryCountInc()
                    response = await page.waitForResponse(response => response.status() === 200, {timeout: 20000})
                    queryCountDec()
                } catch(error) {
                    queryCountDec()
                    log.error(`for url: ${url}, error: ${error}`);
                }
            }
            if(response != null)
                statusCode = response.status();

            // if any 4xx error, try removing / at the end, although we save in DB keeping / at the end to
            if(statusCode == null || Math.floor(statusCode/100) === 4) {
                const url_end_slash_removed = url.slice(0,-1)
                try {
                    queryCountInc()
                    response = await page.goto(url_end_slash_removed, {waitUntil: "networkidle", timeout: 20000 });
                    queryCountDec()
                } catch(error) {
                    queryCountDec()
                    try {
                        queryCountInc()
                        response = await page.waitForResponse(response => response.status() === 200, {timeout: 20000})
                        queryCountDec()
                    } catch(error) {
                        queryCountDec()
                        log.error(`for url: ${url}, error: ${error}`);
                    }
                }
            }
            if(response == null)
                statusCode = 999
            else
                statusCode = response.status();

            if(statusCode === 999) throw new Error(`Response is null`)
            if (statusCode !== 200) throw new Error(`${statusCode}`);

            if(url_status_map.has(url) && url_status_map.get(url).status === true){
                log.info(`Page ${url} already processed`)
                reject('Page already processed')
                return
            }

            const contentType = response.headers()['content-type']
            if(!isContentTypeValid(contentType)) {
                throw new Error(`response url ${page.url()}, content type: ${contentType} invalid`)
            }

            const chain = redirectionChain((new URL(url)).href, response);
            chain.reverse()
            log.info("Generated Chain: ", chain.join(','));

            const insertId = await handleMapping(url_status_map, url, domain, level, 1, '[' + chain.join(', ') + ']')
            data['domain'] = domain;
            data['url'] = url;
            data['response'] = await page.content();
            data['redirection_chain'] = chain

            await Promise.all([
                // await writeAsJson(data['response'], filename, domain)
                await writePageContentToS3(JSON.stringify(data), domain, url, insertId)
            ]).then((msg) => {
                log.info(`saving html for ${url} to s3`)
            }).catch((err) => {
                const query = `update ${CRAWL_STATUS} set status=-1,log="${err}" where domain='${domain}' and url='${url}'`
                queryCountInc()
                db.query(query, (err, result, fields) => {
                    queryCountDec()
                    if(err){
                        log.error(`${query}, error: ${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
                log.error(err);
            })

            await downloadImages(page, insertId, url, domain, downloaded_filenames).then(res => log.info(res)).catch(err => log.error(err))

            await Promise.all([
                await extractUrls(page, url_status_map, level, domain)
            ]).catch((message) => {
                log.error(message);
            })

            resolve(data);
        } catch (error) {
            log.error(`error in crawl, url: ${url}, ${error}`);
            if(!fileTypeIsADownloadable(url)) {
                if (url_status_map.has(url) && error.message !== 'URL already crawled') {
                    const query = `update ${CRAWL_STATUS}
                                   set status= -1,
                                       log="${error.toString().slice(0, 800)}"
                                   where domain ='${domain}' and url='${url}'`;
                    queryCountInc()
                    db.query(query, (err, result, fields) => {
                        queryCountDec()
                        if (err) {
                            log.error(`${query}, error: ${err}`)
                        } else {
                            log.info(`${query}, success`)
                        }
                    })
                } else if (!url_status_map.has(url)) {
                    const query = `insert into ${CRAWL_STATUS} (domain, url, level, status, log)
                                   values ('${domain}', '${url}', ${level}, -1, "${error.toString().slice(0, 800)}")`
                    queryCountInc()
                    db.query(query, (err, result, fields) => {
                        queryCountDec()
                        if (err) {
                            log.error(`${query}, error: ${err}`)
                        } else {
                            log.info(`${query}, success`)
                        }
                    })
                }
            }
            reject(error.message);
        } finally {
            if (page !== null) {
                await page.close();
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