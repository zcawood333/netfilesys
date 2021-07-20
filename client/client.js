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
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const formData = require('form-data');
const fs = require('fs');
const dgram = require('dgram');
const multicastClient = dgram.createSocket('udp4');
const multicastAddr = '230.185.192.108';
const multicastServerPort = 5002;
const multicastClientPort = 5001;
const { exit } = require('process');
const numGetAttempts = 8; // number of attempts to GET a file
const getAttemptTimeout = 200; // milliseconds GET attempt will wait before trying again
const getDownloadPath = `${__dirname}/downloads/`; //where files from GET are stored
const tempFilePath = `${__dirname}/tmp/`; //temporary spot for encrypted files
const uploadLogPath = `${__dirname}/logs/upload_log.csv`; //stores filekeys (serverUUID + clientKey + clientIV) and the datetime

//Defaults
let tcpServerPort = 5000;
let tcpServerHostname = 'localhost'
let path = '';
let method = 'GET';
let fpath = null;
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
            if (argv.noEncryption) {
                POST(false);
            } else {
                POST(true);
            }
            break;
        case 'put':
            if (argv.noEncryption) {
                PUT(false);
            } else {
                PUT(true);
            }
            break;
        default:
            throw new Error(`Unrecognized command: ${argv._[0]}`)
    }
} else {
    //flag based, old implementation; probably needs cleaned up eventually
    if (argv.multicast) {
        //send a multicast message and close the connection
        initMulticastClient();
        sendMulticastMsg(argv.multicast, true);
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
        let form = undefined;
        if (method === 'POST') {
            form = new formData();
            changeMethodToPost(options, form);
        }
        const req = http.request(options);
        //init req event listeners
        initRequest(req);
        //send request
        sendRequest(req, method === 'POST', form);
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
        } else {
            if (debug) {console.log(`arg: ${arg} is not a valid uuid`);}
        }
    });
}
function validUUID(val) {
    let newVal = val.replace(/-/g,'');
    if (newVal.length !== 32) {throw new Error('Invalid UUID')}
    for (let i = 0; i < newVal.length; i++) {
        let char = newVal.charAt(i);
        if ((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {continue}
        return false;
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
    initRequest(req, true, fileUUID);
    sendRequest(req);
}
function PUT(encrypt) {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error('Usage: PUT <filePath>...');
    }
    let args = argv._.slice(1);
    args.forEach(arg => {
        let filePath = arg;
        if (fs.existsSync(filePath)) {
            if (encrypt) {
                const uuid = uuidv4().replace(/-/g,'');
                const iv = crypto.randomBytes(8).toString('hex');
                const encryptedFilePath = `${tempFilePath}${uuid}`;
                aesEncrypt(filePath, encryptedFilePath, uuid, iv, !debug, () => {
                    httpPut(tcpServerHostname, tcpServerPort, encryptedFilePath, uuid, iv);
                }); 
            } else {
                httpPut(tcpServerHostname, tcpServerPort, filePath);
            }
        } else {
            if (debug) {console.log(`filepath: ${filePath} does not exist`);}
        }
    });
}
function httpPut(hostname = tcpServerHostname, port = tcpServerPort, filePath, key = '', iv = '', callback = () => {}) {
    const options = {
        hostname: hostname,
        port: port,
        path: '/upload',
        method: 'PUT'
    }
    let putFile = undefined;
    try {
        putFile = fs.createReadStream(filePath);
    } catch {
        if (debug) {console.log(`Unable to read file path: ${filePath}`);}
        return;
    }
    const req = http.request(options);
    initRequest(req, false, undefined, false, true, key, iv);
    putFile.on('error', err => {
        console.error(err);
    });
    putFile.on('end', () => {
        if (debug) {console.log(`Sent PUT request with path: ${filePath}`);}
        putFile.close();
        callback();

    })
    putFile.pipe(req);
}
function POST(encrypt = false) {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error('Usage: POST <filePath>...');
    }
    let args = argv._.slice(1);
    args.forEach(arg => {
        let filePath = arg;
        if (fs.existsSync(filePath)) {
            if (encrypt) {
                const uuid = uuidv4().replace(/-/g,'');
                const iv = crypto.randomBytes(8).toString('hex');
                const encryptedFilePath = `${tempFilePath}${uuid}`;
                aesEncrypt(filePath, encryptedFilePath, uuid, iv, !debug, () => {
                    httpPost(tcpServerHostname, tcpServerPort, encryptedFilePath, uuid, iv);
                }); 
            } else {
                httpPost(tcpServerHostname, tcpServerPort, filePath);
            }
        } else {
            if (debug) {console.log(`filePath: ${filePath} does not exist`);}
        }
    });
}
function httpPost(hostname = tcpServerHostname, port = tcpServerPort, filePath, key = '', iv = '') {
    const options = {
        hostname: hostname,
        port: port,
        path: '/upload',
        method: 'POST'
    }
    //format file data
    const form = new formData();
    let postFile = undefined;
    try {
        postFile = fs.createReadStream(filePath);
    } catch {
        if (debug) {console.log(`Unable to read file path: ${filePath}`);}
        return;
    }
    postFile.on('error', err => {
        console.error(err);
    });
    postFile.on('end', () => {
        if (debug) {console.log(`Sent POST request with path: ${filePath}`);}
        postFile.close();
    });
    form.append('fileKey', postFile);
    options.headers = form.getHeaders();
    //create request
    const req = http.request(options);
    initRequest(req, false, undefined, true, false, key, iv);
    //send request
    sendRequest(req, true, form);
}
function aesEncrypt(unencryptedfilePath, encryptedFilePath, key, iv, removeTempFile = true, callback = () => {}) {
    //encrypts file at old path using key, writes it to new file path
    //assumes the old file path exists
    if (!fs.existsSync(encryptedFilePath.slice(0,-32))) {fs.mkdirSync(encryptedFilePath.slice(0,-32), {recursive: true})};
    const readStream = fs.createReadStream(unencryptedfilePath);
    if (debug) {
        console.log(`key: ${key}`);
        console.log(`iv: ${iv}`);
    }
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const writeStream = fs.createWriteStream(encryptedFilePath);
    readStream.on('error', err => {
        console.error(err);
    });
    cipher.on('error', err => {
        console.error(err);
    });
    writeStream.on('error', err => {
        console.error(err);
    });
    writeStream.on('finish', () => {
        readStream.close();
        writeStream.close();
        callback();
    });
    readStream.pipe(cipher).pipe(writeStream);
    //returns new file path to encrypted file
}
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
function changeMethodToPost(options, form) {
    options.method = 'POST';
    if (!(argv.fpath)) {
        throw new Error('POST request requires a file path');
    }
    fpath = argv.fpath;
    const postFile = fs.createReadStream(fpath);
    form.append('fileKey', postFile);
    options.headers = form.getHeaders();
}
function logUpload(method = 'undefined', serverUUID, clientKey, iv, callback = () => {}) {
    const uploadLogDir = uploadLogPath.split('/').slice(0,-1).join('/');
    console.log(`uploadLogDir: ${uploadLogDir}`)
    if (!fs.existsSync(uploadLogDir)) {fs.mkdirSync(uploadLogDir, {recursive: true})};
    const today = new Date(Date.now());
    fs.appendFile(uploadLogPath, `${method},${clientKey != ''},${serverUUID}${clientKey}${iv},${today.toISOString()}\n`, callback);
}
function initRequest(req, GET = false, downloadFileName = 'downloadFile', POST = false, PUT = false, key = '', iv = '') {
    req.on('error', err => {
        console.error(err)
    });
    req.on('response', res => {
        if (debug) {console.log(`statusCode: ${res.statusCode}`)}
        if (GET) {
            //save file under ./getDownloadPath/uuid, and if the path doesn't exist, create the necessary directories
            let path = `${getDownloadPath}${downloadFileName}`;
            if (debug) {console.log(`path: ${path}`)}
            if (!fs.existsSync(path.slice(0,-32))) {fs.mkdirSync(path.slice(0,-32), {recursive: true})};
            res.pipe(fs.createWriteStream(path));
        }
        res.on('data', d => {
            if (debug) {console.log('data: ', d.toString())}
            if (POST || PUT) {
                logUpload(POST ? 'POST' : 'PUT', d, key, iv, () => {
                    if (debug) {console.log(`file upload logged successfully`);}
                });
            }
        });
    });
}
function sendRequest(req, POST = false, form = undefined) {
    if (POST) {
        //request end is implicit after piping form
        form.pipe(req);
    } else {
        req.end();
    }
}
function printHelp() {
    console.log("Usage: <command> <param>... [--debug] [--noEncryption]\n" +
    " --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=... \n" +
    "    command = GET | PUT | POST\n" +
    "      GET <filekey>...\n" + //filekey will contain uuid and aes key and iv
    "      PUT <filepath>...      (POST) is an alias for PUT but does multipart\n" +
    "      \n"
    );
}