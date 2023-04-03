const AWS = require('aws-sdk');

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
async function writePageContentToS3(pageContent, domain, level, filename) {
    // Set the S3 key for the file based on the domain and level
    const s3Key = `domain/${domain}/level/${level}/${filename}`;

    s3.upload({
        Bucket: 'website-crawler-dump-synaptic',
        Key: s3Key,
        Body: pageContent }, function (err, data) {
            if (err) {
                console.log("Error", err);
            } if (data) {
                console.log("Upload Success", data.Location);
            }
        }
    );

}

module.exports = { writePageContentToS3 };
