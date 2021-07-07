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
const debug = true;
const useUUID = true;

app.use(fileUpload());


app.get('/exist', (req, res) => {
    res.send('Hello world');
});

app.get('/download/:path', (req, res) => {
    if(debug) {console.log('GET request: ', req.params)};

    let path = `${__dirname}${uploadsDir}${req.params.path}`;
    
    if(debug) {console.log(`path: ${path}`)};

    const today = new Date(Date.now());
    fs.appendFile(downloadLogPath, `${req.params.path},${today.toISOString()}\n`, err => {
        if (err) {
            if (debug) {console.log('file unable to be downloaded', err)};
            return res.status(500).send(err);
        } else if(debug) {console.log('file download logged successfully')};
    });
    res.download(path, err => {
        if (err) {
            if(debug) console.log('file unable to be downloaded');
            //normally returns full path which may be undesirable to leak so path is reset
            err.path = req.params.path;
            return res.status(500).send(err);
        }
    });
    
});

app.post('/upload', (req, res) => {
    if(debug) {
        console.log('POST request: ', req.params);
        console.log(`Files: ${req.files}`);
    }
    let fp;
    let path;
    let uuid;

    //pulled from example: https://github.com/richardgirges/express-fileupload/tree/master/example
    if (!req.files || Object.keys(req.files).length === 0) {
        if(debug) {console.log('No files to upload')};
        return res.status(400).send('No files were uploaded.');
    }

    fp = req.files.nameOfInputField;
    const ogUUID = uuidv4();
    if (debug) {console.log(`uuid: ${uuid}`)};
    uuid = ogUUID.replace(/-/g,'');
    if (debug) {console.log(`uuid without dashes: ${uuid}`)};
    uuid = uuid.replace(/(.{3})/g,"$1/")
    if (debug) {console.log(`uuid turned into path: ${uuid}`)};
    path = `${__dirname}${uploadsDir}${uuid}`;

    if (!fs.existsSync(path.slice(0,-2))) {fs.mkdirSync(path.slice(0,-2), {recursive: true})};
    fp.mv(path, err => {
        if (err) {
            if(debug) {console.log('file unable to be uploaded (1)', err)};
            return res.status(500).send(err);
        } else {
            if(debug) {console.log(`File ${fp.name} uploaded to ${path}`)};
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
                    if(debug) {console.log('file upload logged successfully')};
                    //not sure what to send here
                    res.send(ogUUID);
                };
            });
        };
    });    
});

if(debug) console.log('Starting server...');
app.listen(port, '0.0.0.0');