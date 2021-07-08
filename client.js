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
const debug = false;

if (debug) {console.log(argv)};
if (argv.multicast) {
    multicastMsg = argv.multicast;
    const server = dgram.createSocket('udp4');
    const udpHostPort = 5001;
    const udpSendPort = 5002;
    const multicastAddr = '230.185.192.108';

    server.bind(udpHostPort, undefined, () => {
        server.setBroadcast(true);
        server.setMulticastTTL(128);
        server.addMembership(multicastAddr); 
        broadcastNew();
    });
    
    function broadcastNew() {
        const message = new Buffer.from(multicastMsg);
        server.send(message, 0, message.length, udpSendPort, multicastAddr, err => {
            if (err && debug) {console.log(err)};
            server.close();
        });
        console.log("Sent " + message);
        
    }
} else {
    //argv handling and error checking
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
}