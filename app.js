const { website_crawler } = require('./website_crawler.js');
const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");

async function fetch_unprocessed_urls(level) {
    return new Promise((resolve, reject) => {
        // todo: remove limit after testing
        const query = `select domain, url from crawl_status_2 where level=${level} and status=false LIMIT 3`
        db.query(query, (err, res) => {
            const results = []
            if(err) {
                console.log(`error getting urls at level: ${level}`)
                reject(err)
            }
            else {
                res.forEach(row => {
                    console.log("in fetch_unprocessed_urls: " + row.url + ' | url end')
                    results.push(row.url)
                })
                resolve(results)
            }
        })
    })
}

async function get_root_domain(){
    return new Promise((resolve, reject) => {
        db.query(`select name from domains LIMIT 3`, (err, res) => {
            console.log(res.length)
            if(err){
                console.log('error fetching root domain')
                process.exit(0)
                reject()
            }
            const domains = []
            res.forEach(row => {
                console.log(row.name)
                domains.push(row.name)
            })
            resolve(domains)
        });
    })
}

async function processRootDomains() {
    const root_domains = await get_root_domain()
    root_domains.forEach(domain => {
        console.log(domain)
        const event = {body: {raw_url: domain}};
        const context = {level: 0}
        website_crawler(event, context, (err, res) => {
            if (err) {
                console.log(err)
            }
            console.log(res.statusCode)
        })
    })
}

async function run() {
    await processRootDomains();
    let level = 1
    while(1){
        console.log("here, start level: " + level)
        if (level > LEVEL_LIMIT) {
            break
        }
        await Promise.all([
            await fetch_unprocessed_urls(level)
        ]).then(_raw_url_list => {
            const raw_url_list = _raw_url_list[0]
            console.log("rul " + JSON.stringify(raw_url_list))
            if(raw_url_list.length === 0) {
                level++;
                return
            }
            raw_url_list.forEach(url => {
                console.log("rul value " + url)
                console.log("this xyz")
                const event = {body: {raw_url: url}};
                const context = {level: level}
                website_crawler(event, context, (err, res) => {
                    if(err){
                        console.log("abc")
                        console.log(err)
                    } else {
                        console.log("def")
                        console.log(res)
                    }
                })
            })
        }).catch(err => {
            console.log("ghi")
            console.log(err)
        })
        console.log("here, level: " + level)
    }
}

run()
