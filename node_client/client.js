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
const multicastAddr = '230.185.192.108';
const multicastServerPort = 5002;
const multicastClientPort = 5001;
const { exit } = require('process');
const numGetAttempts = 8; // number of attempts to GET a file
const getAttemptTimeout = 200; // milliseconds GET attempt will wait before trying again
const getDownloadPath = '/downloads/';

//Defaults
let tcpServerPort = 5000;
let tcpServerHostname = 'localhost'
let path = '';
let method = 'GET';
let fpath = null;
let postFile = null;
let get = true;
let post = false;
let multicastMsg = null;
let getIntervals = {};



//testing
let debug = false;
if (argv.debug) {
    debug = true;
    console.log('DEBUG OUTPUT ON');
}

//MAIN CODE
if (debug) {console.log('argv: ', argv)};

if (argv.help || (process.argv.length <= 2 || argv._[0] == 'help')) { // if help or no args
    printHelp();
    exit(0);
}

if (argv._.length > 0) {
    //command based
    switch (argv._[0].toLowerCase()) {
        case 'get':
            GET();
            break;
        case 'post':
            POST();
            break;
        case 'put':
            PUT();
            break;
        default:
            throw new Error(`Unrecognized command: ${argv._[0]}`)
    }
} else {
    //flag based, old implementation
    if (argv.multicast) {
        //send a multicast message and close the connection
        multicastMsg = argv.multicast;
        initMulticastClient();
        sendMulticastMsg(multicastMsg, true);
    } else {
        //send a http request
        //argv handling and error checking
        argsHandler();

        //create http request
        const options = {
            hostname: tcpServerHostname,
            port: tcpServerPort,
            path: path,
            method: 'GET'
        }        
        //make POST-specific changes
        if (method === 'POST') {
            changeMethodToPost(options);
        }

        const req = http.request(options);

        //init req event listeners
        initRequest(req);

        //send request
        sendRequest(req);
    }
}

//FUNCTIONS
async function GET() {
    if (argv._.length < 2) {
        throw new Error('Usage: GET <filekey> <filekey2> ...');
    }
    await initMulticastClient();
    let args = argv._.slice(1);
    await getIterThroughArgs(args);
    let closeClient = setInterval(() => {
        if (Object.keys(getIntervals).length === 0) {
            multicastClient.close();
            clearInterval(closeClient);
        }
    }, getAttemptTimeout);
}
async function getIterThroughArgs(args) {
    args.forEach(arg => {
        if (debug) {console.log(`current uuid: ${arg}`);}
        if (validUUID(arg)) {
            let uuid = arg.replace(/-/g,'');
            getIntervals[uuid] = {
                interval: setInterval(() => {
                    if (getIntervals[uuid]['attempts'] < numGetAttempts) {
                        sendMulticastMsg('g' + uuid);
                        getIntervals[uuid]['attempts']++;
                    } else {
                        if (debug) {console.log(`file with uuid: ${uuid} not found`);}
                        if (debug) {console.log(`now deleting interval for uuid: ${uuid}`);}
                        clearInterval(getIntervals[uuid]['interval']);
                        delete getIntervals[uuid];
                    }
                }, getAttemptTimeout),
                attempts: 0,
            }
        }
    });
}
function validUUID(val) {
    let newVal = val.replace(/-/g,'');
    if (newVal.length !== 32) {throw new Error('Invalid UUID')}
    for (let i = 0; i < newVal.length; i++) {
        let char = newVal.charAt(i);
        if ((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {continue}
        throw new Error('Invalid UUID');
    }
    return true;
}
function httpGet(hostname = tcpServerHostname, port = tcpServerPort, fileUUID) {
    const options = {
        hostname: hostname,
        port: port,
        path: '/download/' + fileUUID,
        method: 'GET'
    }
    const req = http.request(options);
    initRequest(req, fileUUID);
    sendRequest(req);
}
function PUT() {}
function POST() {}
async function initMulticastClient() {
    multicastClient.on('listening', function () {
        if (debug) {
            console.log(`multicastClient listening on multicast address ${multicastAddr}`);
        }
        multicastClient.setBroadcast(true);
        multicastClient.setMulticastTTL(128); 
        multicastClient.addMembership(multicastAddr);
    });
    multicastClient.on('message', (message, remote) => {   
        if (debug) {console.log('From: ' + remote.address + ':' + remote.port +' - ' + message)};
        message = message.toString();
        switch (message.charAt(0)) {
            case 'h':
                //validate uuid
                let uuid = message.slice(1);
                if (validUUID(uuid) && getIntervals[uuid]) {
                    //clear uuid interval
                    clearInterval(getIntervals[uuid]['interval']);
                    delete getIntervals[uuid];
                    //get file from server claiming to have it
                    httpGet(remote.address, tcpServerPort, uuid);
                }
                
                break;
            default:
                break;
        }
    });
    if (debug) console.log(`Starting multicastClient on port ${multicastServerPort}`);
    multicastClient.bind(multicastClientPort);
}
function sendMulticastMsg(msg = 'this is a sample multicast message (from client)', close = false, targetPort = multicastServerPort, targetAddr = multicastAddr) {
    const message = new Buffer.from(msg);
    multicastClient.send(message, 0, message.length, targetPort, targetAddr, () => {
        if (close) {
            multicastClient.close();
            if (debug) {console.log('multicastClient closed')}
        }
    });
    if (debug) {console.log("Sent " + message)}
}
function argsHandler() {
    if (argv.hostname) {tcpServerHostname = argv.hostname};
    if (argv.path) {path = argv.path};
    if (argv.port) {tcpServerPort = argv.port};
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
        throw new Error('POST request requires a file path');
    }
    fpath = argv.fpath;
    postFile = fs.createReadStream(fpath);
    form.append('fileKey', postFile);
    options.headers = form.getHeaders();
}
function initRequest(req, uuid = '') {
    req.on('error', error => {
        console.error(error)
    });

    req.on('response', res => {
        if (debug) {console.log(`statusCode: ${res.statusCode}`)}
        if (uuid != '') {
            //save file under ./getDownloadPath/uuid, and if the path doesn't exist, create the necessary directories
            let path = `${__dirname}${getDownloadPath}${uuid}`;
            if (debug) {console.log(`path: ${path}`)}
            if (!fs.existsSync(path.slice(0,-32))) {fs.mkdirSync(path.slice(0,-32), {recursive: true})};
            res.pipe(fs.createWriteStream(path));
        }
        res.on('data', d => {
            if (debug) {console.log(d.toString())}
        });
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
function printHelp() {
    console.log("Usage: <command> <param>\n" +
    " --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=... \n" +
    "    command = GET | PUT | POST\n" +
    "      GET <filekey> ...\n" + //filekey will contain uuid and aes key
    "      PUT <filename>      (POST) is an alias for PUT but does multipart\n" +
    "      \n"
    );
}