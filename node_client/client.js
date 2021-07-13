#!/usr/local/bin/node

//command line client utility; sends get or post requests
//keyword args: --multicast='message', --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=...
//multicast: will send a multicast message to default address
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
const dgram = require('dgram');
const multicastClient = dgram.createSocket('udp4');
const multicastServerAddr = '230.185.192.109';
const multicastClientAddr = '230.185.192.108';
const multicastServerPort = 5002;
const multicastClientPort = 5001;
const { exit } = require('process');

//Defaults
let port = 5000;
let hostname = 'localhost'
let path = '';
let method = 'GET';
let fpath = null;
let postFile = null;
let get = true;
let post = false;
let multicastMsg = null;

//testing
let debug = false;
if (argv.debug)
    debug = true;
    
if (debug) {console.log(`argv: ${argv}`)};

if (argv.help || (process.argv.length <= 2)) { // if help or no args
    console.log("Usage:\n" +
    " --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=... \n" +
    "    command = GET | PUT | POST\n" +
    "      GET <UUID>\n" +
    "      PUT <filename>      (POST) is an alias for PUT but does multipart\n" +
    "      \n"
    );
    exit(0);
}
if (argv.multicast) {
    multicastMsg = argv.multicast;
    initMulticastClient();
    sendMulticastMsg(multicastMsg);
} else {
    //argv handling and error checking
    if (argv.hostname) {hostname = argv.hostname};
    if (argv.path) {path = argv.path};
    if (argv.port) {port = argv.port};
    if (argv.method && 
        (argv.method === 'p' 
        || argv.method === 'post' 
        || argv.method === 'get' 
        || argv.method === 'g')) {
        method = argv.method;
    }

    const options = {
        hostname: hostname,
        port: port,
        path: path,
        method: 'GET'
    }

    //make POST-specific changes
    if (method.toLowerCase() === 'post' 
        || method.toLowerCase() === 'p') {
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
}

//FUNCTIONS
function initMulticastClient() {
    multicastClient.on('listening', function () {
        if (debug) {
            console.log(`multicastClient listening on multicast address ${multicastClientAddr}:${multicastClientPort}`);
        }
        multicastClient.setBroadcast(true);
        multicastClient.setMulticastTTL(128); 
        multicastClient.addMembership(multicastClientAddr);
    });
    multicastClient.on('message', (message, remote) => {   
        if (debug) {console.log('From: ' + remote.address + ':' + remote.port +' - ' + message)};
    });
    multicastClient.bind(multicastClientPort);
}
function sendMulticastMsg(msg = 'this is a sample multicast message (from server)') {
    const message = new Buffer.from(msg);
    multicastClient.send(message, 0, message.length, multicastServerPort, multicastServerAddr);
    if (debug) {console.log("Sent " + message)}
}