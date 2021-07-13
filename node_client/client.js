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

if (argv.help || (process.argv.length <= 2 || argv._[0] == 'help')) { // if help or no args
    console.log("Usage:\n" +
    " --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=... \n" +
    "    command = GET | PUT | POST\n" +
    "      GET <UUID>\n" +
    "      PUT <filename>      (POST) is an alias for PUT but does multipart\n" +
    "      \n"
    );
    exit(0);
}

if (argv._) {
    //command based
} else {
    //flag based, old implementation
    if (argv.multicast) {
        //send a multicast message and close the connection
        multicastMsg = argv.multicast;
        initMulticastClient();
        sendMulticastMsg(multicastMsg, true);
    } else {
        //send a http request
        const options = {
            hostname: hostname,
            port: port,
            path: path,
            method: 'GET'
        }
        const req = http.request(options);
        //argv handling and error checking
        argsHandler();

        //make POST-specific changes
        if (method === 'POST') {
            changeMethodToPost(options);
        }

        initRequest(req);

        sendRequest(req);
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
function sendMulticastMsg(msg = 'this is a sample multicast message (from client)', close = false) {
    const message = new Buffer.from(msg);
    multicastClient.send(message, 0, message.length, multicastServerPort, multicastServerAddr, () => {
        if (close) {
            multicastClient.close();
            if (debug) {console.log('multicast client closed')}
        }
    });
    if (debug) {console.log("Sent " + message)}
}
function argsHandler() {
    if (argv.hostname) {hostname = argv.hostname};
    if (argv.path) {path = argv.path};
    if (argv.port) {port = argv.port};
    if (argv.method) { 
        switch (argv.method.toLowerCase()) {
            case 'p':
            case 'post':
                method = 'POST';
                break;
            case 'g':
            case 'get':
                method = 'GET';
                break;
            default:
                throw new Error(`Unknown method: ${argv.method}`);
        }
    }
}
function changeMethodToPost(options) {
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
function initRequest(req) {
    req.on('error', error => {
        console.error(error)
    });

    req.on('response', res => {
        console.log(`statusCode: ${res.statusCode}`)

        res.on('data', d => {
            console.log(d.toString());
        })
    });
}
function sendRequest(req) {
    if (post) {
        //request end is implicit after piping form
        form.pipe(req);
    } else {
        req.end();
    }
}