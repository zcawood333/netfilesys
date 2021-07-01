//main.js

const express = require('express');
const app = express();
const { v4: uuidv4 } = require('uuid');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const port = 5000;
const uploadsDir = '/uploads/';
const uploadLogPath = './upload_log.csv';
const downloadLogPath = './download_log.csv';

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
    if(useUUID) {
        uuid = uuidv4();
        path = `${__dirname}${uploadsDir}${uuid}`;
        //store uuid along with filename using filename as keys in a sorted list
        const today = new Date(Date.now());
        fs.appendFile(uploadLogPath, `${fp.name},${uuid},${today.toISOString()}\n`, err => {
            if (err) {
                if (debug) {console.log('file unable to be uploaded', err)};
                return res.status(500).send(err);
            } else if(debug) {console.log('file upload logged successfully')};
        });
        //search for filename in log using binary search
        //if filename (key) is a duplicate, search through uuids (values) and see if any of the files at those locations are equivalent to the given
    } else {
        path = `${__dirname}${uploadsDir}${fp.name}`;
    }


    fp.mv(path, err => {
        if (err) {
            if(debug) console.log('file unable to be uploaded', err);
            return res.status(500).send(err);
        }
        if(debug) console.log(`File ${fp.name} uploaded to ${path}`);
        if(useUUID) {
            res.send(uuid);
        } else {
            res.send('File uploaded!');
        }
    });
});

if(debug) console.log('Starting server...');
app.listen(port, '0.0.0.0');