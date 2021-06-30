//main.js

const express = require('express');
const app = express();
const fileUpload = require('express-fileupload');
const port = 5000;
const uploadsDir = '/uploads/';
const debug = true;

app.use(fileUpload());

app.get('/files', (req, res) => {
    if(debug) console.log('GET request: ', req.params);
    res.send('this will be a download');
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
        return res.status(400).send('No files were uploaded.');
      }

    fp = req.files.nameOfInputField;
    uploadPath = __dirname + uploadsDir + fp.name;

    fp.mv(uploadPath, err => {
    if (err) return res.status(500).send(err);
    if(debug) console.log(`File ${fp.name} uploaded to ${uploadPath}`);
    res.send('File uploaded!');
    });
});

if(debug) console.log('Starting server...');
app.listen(port);