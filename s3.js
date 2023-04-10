const AWS = require('aws-sdk');
const db = require('./db')
const log = require('./logger')

const credentials = new AWS.SharedIniFileCredentials({profile: 'default'});
AWS.config.credentials = credentials;

// Initialize the S3 client
const s3 = new AWS.S3({
    // Set your AWS access credentials and region here
    accessKeyId: AWS.config.credentials.accessKeyId,
    secretAccessKey: AWS.config.credentials.secretAccessKey,
    sessionToken: AWS.config.credentials.sessionToken,
    region: 'us-east-1'
});

// Define the function to write the page content to an S3 file
async function writePageContentToS3(pageContent, domain, url, filename) {
    // Set the S3 key for the file based on the domain and level
    const s3Key = `${domain}/${filename}`;

    s3.upload({
        Bucket: 'website-crawler-dump-synaptic',
        Key: s3Key,
        Body: pageContent }, function (err, data) {
            if (err) {
                db.query(`update crawl_status_2 set log="can't upload to s3: ${err.name}" where domain='${domain}' and url='${url}'`)
                log.error(`s3 upload error for url ${url}: ${err}`)
            } if (data) {
                db.query(`update crawl_status_2 set s3_uri='${data.Location}' where domain='${domain}' and url='${url}'`, (err, result, fields) => {
                    if(err){
                        db.query(`update crawl_status_2 set log="can't update s3_uri: ${err.name}" where domain='${domain}' and url='${url}'`)
                        log.error(`db update error: ${err}`)
                    }
                    else{
                        log.info('s3_uri updated for ' + url)
                    }
                })
                log.info("S3 Upload Success");
            }
        }
    );
}

module.exports = { writePageContentToS3 };
