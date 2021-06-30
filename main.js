//main.js

const express = require('express');
const app = express();
const port = 5000;
const debug = true;

app.get('/files', (req, res) => {
    if(debug) console.log('GET request...');
    res.send('this will be a download');
});

app.post('/upload', (req, res) => {
    if(debug) console.log('POST request...');
    res.send('this will be an upload');
});

app.listen(port);