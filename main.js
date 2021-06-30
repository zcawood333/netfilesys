//main.js

const express = require('express');
const app = express();
const fileUpload = require('express-fileupload');
const port = 5000;
const uploadsDir = '/uploads/';
const debug = true;

app.use(fileUpload());

app.get('/download/:path', (req, res) => {
    if(debug) console.log('GET request: ', req.params);

    let path = `${__dirname}${uploadsDir}${req.params.path}`;
    if(debug) console.log(`path: ${path}`);

    res.download(path, err => {
        if (err) {
            if(debug) console.log('file unable to be downloaded');
            //returning full path, which may be undesirable to leak so path is reset
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

    //pulled from example: https://github.com/richardgirges/express-fileupload/tree/master/example
    if (!req.files || Object.keys(req.files).length === 0) {
        if(debug) console.log('No files to upload');
        return res.status(400).send('No files were uploaded.');
      }

    fp = req.files.nameOfInputField;
    path = `${__dirname}${uploadsDir}${fp.name}`;

    fp.mv(path, err => {
    if (err) {
        if(debug) console.log('file unable to be uploaded');
        return res.status(500).send(err);
    }
    if(debug) console.log(`File ${fp.name} uploaded to ${path}`);
    res.send('File uploaded!');
    });
});

if(debug) console.log('Starting server...');
app.listen(port);