'use strict';
const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");
const website_crawler_sync = require("./website_crawler");
const log = require('./logger')

async function fetch_unprocessed_urls(level) {
    return new Promise((resolve, reject) => {
        const query = `select domain, url from crawl_status where level=${level} and status=0`
        db.query(query, (err, res) => {
            const results = []
            if(err) {
                log.error(`error getting urls at level: ${level}`)
                reject(err)
            }
            else {
                res.forEach(row => {
                    results.push({url: row.url, domain: row.domain})
                })
                resolve(results)
            }
        })
    })
}

async function get_root_domain(){
    return new Promise((resolve, reject) => {
        const argv = process.argv
        const limit = argv[2]
        const offset = argv[3]
        const query = `select name from domains left outer join crawl_status on domains.name = crawl_status.domain where domain is NULL LIMIT ${limit} OFFSET ${offset}`
        console.log(query)
        db.query(query, (err, res) => {
            if(err){
                log.error('error fetching root domain, terminating app')
                process.exit(0)
                reject()
            }
            const domains = []
            res.forEach(row => {
                domains.push(row.name)
            })
            resolve(domains)
        });
    })
}

async function processRootDomains() {
    log.info('processing root domains')
    const root_domains = await get_root_domain();
    for (const domain of root_domains) {
        if(domain.includes(':')) continue
        const url_status_map = await getDomainUrls(domain)
        const event = {body: {domain: domain, level: 0}};
        try {
            await website_crawler_sync(event, url_status_map);
        } catch (err) {
            log.error('error to process root domains: ' + err)
        }
    }
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
                    if(!url_status_map.has(row.url) || (url_status_map.has(row.url) && url_status_map.get(row.url).status !== 1 && row.status === 1)){
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

async function run() {
    log.info('=====started======')
    await processRootDomains();

    let level = 1
    while(1){
        if (level > LEVEL_LIMIT) {
            break
        }
        const domain_url_list = await fetch_unprocessed_urls(level)
        if(domain_url_list.length === 0) {
            level++;
            break
        }

        for(const domain_url of domain_url_list){
            const event = {body: {url: domain_url.url, domain: domain_url.domain, level: level}};
            const url_status_map = await getDomainUrls(domain_url.domain)
            try {
                if(url_status_map.has(domain_url.url) && (url_status_map.get(domain_url.url).status === 1 || url_status_map.get(domain_url.url).status === -1)) continue
                // -2 to mark that code has touched this url
                const query = `update crawl_status set status=-2 where domain='${domain_url.domain}' and url='${domain_url.url}'`
                db.query(query, (err, res, fields) => {
                    if (err) {
                        log.error(`${query}, error: ${err}`)
                        throw new Error(`${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
                const res = await website_crawler_sync(event, url_status_map);
                console.log(res)
            } catch (err) {
                log.error('website_crawler_sync error: ' + err)
            }
        }
    }
    log.info("===ending===")
}

run()
