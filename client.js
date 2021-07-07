
const argv = require('minimist')(process.argv.slice(2));
const http = require('http');
const formData = require('form-data');
const form = new formData();
const fs = require('fs');
const dgram = require('dgram');
const server = dgram.createSocket("udp6");

//Defaults
let port = 5000;
let hostname = 'localhost'
let path = '';
let method = 'GET';
let fpath = null;
let postFile = null;
let get = true;
let post = false;

const debug = true;

//argv handling and error checking
if (debug) {console.log(argv)};
if (argv.hostname) {
    hostname = argv.hostname;
}
if (argv.path) {
    path = argv.path;
}
if (argv.port) {
    port = argv.port;
}
if (argv.method) {
    method = argv.method;
}

const options = {
    hostname: hostname,
    port: port,
    path: path,
    method: 'GET'
}

if (method.toLowerCase() === 'post' || method.toLowerCase() === 'p') {
    post = true;
    get = false;
    options.method = 'POST';
    if (!(argv.fpath)) {
        throw new Error('this post request requires a file path');
    }
    fpath = argv.fpath;
    postFile = fs.createReadStream(fpath);
    form.append('fileKey', postFile);
    options.headers = form.getHeaders();
}
//fpath.split('/').slice(-1)

const req = http.request(options);


req.on('error', error => {
    console.error(error)
});

req.on('response', res => {
    console.log(`statusCode: ${res.statusCode}`)

    res.on('data', d => {
        console.log(d.toString());
    })
});

if (post) {
    form.pipe(req);
} else {
    req.end();
}