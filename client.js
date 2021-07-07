
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
    console.log(`file path: ${fpath}`);
    console.log(`file name: ${fpath.split('/').slice(-1)}`);
    form.append(fpath.split('/').slice(-1), postFile);
    options.headers = form.getHeaders();
}

const req = http.request(options, res => {
    console.log(`statusCode: ${res.statusCode}`)

    res.on('data', d => {
    process.stdout.write(d)
    })
})

req.on('error', error => {
    console.error(error)
})

if (post) {
    form.pipe(req);
    req.end()
} else {
    req.end()
}