//command line client utility; sends get or post requests
//keyword args: --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=...
//method: determines whether http request is GET or POST request
//hostname: hostname to send the request to
//port: port to send the request to
//path: path to send the request to; ie. port=/download --> http://hostname:port/download
//fpath: file path for post request
const argv = require('minimist')(process.argv.slice(2));
const http = require('http');
const formData = require('form-data');
const form = new formData();
const fs = require('fs');

//Defaults
let port = 5000;
let hostname = 'localhost'
let path = '';
let method = 'GET';
let fpath = null;
let postFile = null;
let get = true;
let post = false;

//testing
const debug = false;

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
if (argv.method && (argv.method === 'p' || argv.method === 'post' || argv.method === 'get' || argv.method === 'g')) {
    method = argv.method;
}

const options = {
    hostname: hostname,
    port: port,
    path: path,
    method: 'GET'
}

//make POST-specific changes
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
    //request end is implicit after piping form
    form.pipe(req);
} else {
    req.end();
}