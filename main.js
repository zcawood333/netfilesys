//main.js

const express = require('express');
const app = express();
const { v4: uuidv4 } = require('uuid');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const port = 5000;
const uploadsDir = '/uploads/';
const uploadLogPath = './logs/upload_log.csv';
const downloadLogPath = './logs/download_log.csv';

//testing variables
const debug = false;

app.use(fileUpload());


app.get('/exist', (req, res) => {
    res.send('Hello world\n');
});

app.get('/download/:uuid', (req, res) => {
    if (debug) {console.log('GET request: ', req.params)};
    let parsedUUIDPath = req.params.uuid;
    parsedUUIDPath = parsedUUIDPath.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    let path = `${__dirname}${uploadsDir}${parsedUUIDPath}`;
    
    if (debug) {console.log(`path: ${path}`)};

    const today = new Date(Date.now());
    fs.appendFile(downloadLogPath, `${req.params.uuid},${today.toISOString()}\n`, err => {
        if (err) {
            if (debug) {console.log('file download unable to be logged, and therefore will not be downloaded', err)};
            return res.status(500).send(err);
        } else {
            res.download(path, err => {
                if (err) {
                    if (debug) {console.log('file unable to be downloaded', err)};

                    //remove last line from log file
                    fs.readFile(downloadLogPath, (err, data) => {
                        if (err) {
                            if (debug) {console.log('download log file unable to be modified; most recent log is invalid')};
                        } else {
                            console.log(data);
                            //need to slice to -2 because there is a new line character after last entry
                            let newData = data.toString().split('\n').slice(0,-2).join('\n') + '\n';
                            fs.writeFile(downloadLogPath, newData, err => {
                                if (err) {
                                    if (debug) {console.log('download log file unable to be written to; it may now be corrupted')};
                                } else {
                                    if (debug) {console.log('download log file updated to remove bad download line')};
                                }
                            });
                        }
                    });

                    //normally returns full path which may be undesirable to leak so path is reset
                    //err.path = req.params.uuid;
                    return res.status(500).send(err);
                } else {
                    if (debug) {
                        console.log('file downloaded successfully');
                        console.log('file download logged successfully');
                    }
                }
            })
        }
    });
    
    
    
    
});

app.post('/upload', (req, res) => {
    if (debug) {
        console.log('POST request headers: ', req.headers);
        console.log('POST request body: ', req.body);
        console.log(`Files: ${req.files}`);
    }
    let fp;
    let path;
    let uuid;

    //pulled from example: https://github.com/richardgirges/express-fileupload/tree/master/example
    if (!req.files || Object.keys(req.files).length === 0) {
        if (debug) {console.log('No files to upload')};
        return res.status(400).send('No files were uploaded.');
    }

    fp = req.files.fileKey;
    const ogUUID = uuidv4();
    if (debug) {console.log(`uuid: ${ogUUID}`)};
    uuid = ogUUID.replace(/-/g,'');
    if (debug) {console.log(`uuid without dashes: ${uuid}`)};
    uuid = uuid.replace(/(.{3})/g,"$1/")
    if (debug) {console.log(`uuid turned into path: ${uuid}`)};
    path = `${__dirname}${uploadsDir}${uuid}`;

    if (!fs.existsSync(path.slice(0,-2))) {fs.mkdirSync(path.slice(0,-2), {recursive: true})};
    fp.mv(path, err => {
        if (err) {
            if (debug) {console.log('file unable to be uploaded (1)', err)};
            return res.status(500).send(err);
        } else {
            if (debug) {console.log(`File ${fp.name} uploaded to ${path}`)};
            const today = new Date(Date.now());
            fs.appendFile(uploadLogPath, `${fp.name},${ogUUID},${today.toISOString()}\n`, err => {
                if (err) {
                    if (debug) {console.log('file unable to be uploaded (2)', err)};
                    fs.rm(path, err => {
                        if (err) {
                            if (debug) {console.log(`File ${fp.name} unable to be removed at ${path}`)};
                        } else {
                            if (debug) {console.log(`File ${fp.name} removed from ${path}`)};
                        }
                    });
                    return res.status(500).send(err);
                } else {
                    if (debug) {console.log('file upload logged successfully')};
                    //not sure what to send here
                    res.send(ogUUID);
                };
            });
        };
    });    
});

if (debug) console.log('Starting server...');
app.listen(port, '0.0.0.0');