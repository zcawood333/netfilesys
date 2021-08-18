#!/usr/bin/node

const argv = processArgv(process.argv.slice(2));
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const formData = require('form-data');
const fs = require('fs');
const dgram = require('dgram');
const multicastClient = dgram.createSocket({type: 'udp4', reuseAddr: true});
const multicastAddr = '230.185.192.108';
const ipAddr = require('ip').address();
const { exit } = require('process');
const numAttempts = 8; // number of attempts to complete a command (send multicast message)
const attemptTimeout = 200; // milliseconds attempt will wait before trying again
const downloadPath = `${__dirname}/downloads/`; //where files downloaded with GET are stored
const uploadLogPath = `${__dirname}/logs/upload_log.csv`; //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime
const uploadLogFormat = {columns: ['method', 'encrypted', 'fileKey', 'bucket', 'datetime']} //used to create log file if missing
const downloadLogPath = `${__dirname}/logs/download_log.csv`; //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime
const downloadLogFormat = {columns: ['uuid','datetime']} //used to create log file if missing
const maxFileLengthBytes = 255;
const { GetRequest, PutRequest, PostRequest } = require('./requests');

//command defaults
let requests = {};
let multicastPort = 5001;


//testing
let debug = false;
if (argv.debug) {
    debug = true;
    console.log('DEBUG OUTPUT ON');
}

//MAIN CODE
if (debug) { console.log('argv: ', argv) };

if (argv.help || (process.argv.length <= 2 || argv._length <= 0 || argv._[0] == 'help')) { // if help or no args
    printHelp();
    exit(0);
}

if (argv._.length > 0) {
    //command based
    commandArgsHandler();
    switch (argv._[0].toLowerCase()) {
        case 'get':
            get();
            break;
        case 'post':
            upload(post = true);
            break;
        case 'put':
            upload();
            break;
        default:
            throw new Error(`Unrecognized command: ${argv._[0]}`)
    }
}

//FUNCTIONS
async function get() {
    if (argv._.length < 2) {
        throw new Error('Usage: GET <fileKey> <fileKey2> ...');
    }
    await initMulticastClient();
    const args = argv._.slice(1);
    await getIterThroughArgs(args);
    closeMulticastClient(() => {
        const keys = Object.keys(requests);
        let close = true;
        for(let i = 0; i < keys.length; i++) {
            if (requests[keys[i]].failed) {
                delete requests[keys[i]];
            } else {
                close = false;
            }
        }
        return close;
    }, attemptTimeout);
}
async function getIterThroughArgs(args) {
    args.forEach((arg, idx) => {
        try {
            const reqObj = new GetRequest(() => {sendMulticastMsg('g' + arg.substr(0,32))}, attemptTimeout, numAttempts, undefined, undefined, undefined, downloadPath, argv.outputFiles[idx], arg);
            if (debug) { console.log(reqObj); }
            requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        } 
    });
}
function httpGet(reqObj, callback = () => {}) {
    const options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: '/download/' + reqObj.uuid,
        method: 'GET'
    }
    reqObj.req = http.request(options);
    initRequest(reqObj, callback, undefined);
    sendRequest(reqObj, undefined);
}
async function upload(post = false) {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error(`Usage: ${post ? 'POST' : 'PUT'} <filePath>...`);
    }
    await initMulticastClient();
    const args = argv._.slice(1);
    await uploadIterThroughArgs(args, post);
    closeMulticastClient(() => {
        const keys = Object.keys(requests);
        let close = true;
        for(let i = 0; i < keys.length; i++) {
            if (requests[keys[i]].failed) {
                delete requests[keys[i]];
            } else {
                close = false;
            }
        }
        return close;
    }, attemptTimeout);
}
async function uploadIterThroughArgs(args, post = false) {
    args.forEach(arg => {
        try {
            const fileSize = fs.statSync(arg).size + 8;
            const uuid = uuidv4().replace(/-/g, '');
            let reqObj = null;
            if (post) {
                reqObj = new PostRequest(() => {sendMulticastMsg('u' + uuid + ':' + fileSize)}, attemptTimeout, numAttempts, undefined, undefined, undefined, argv.bucket, !argv.noEncryption, arg, uuid, fileSize);
            } else {
                reqObj = new PutRequest(() => {sendMulticastMsg('u' + uuid + ':' + fileSize)}, attemptTimeout, numAttempts, undefined, undefined, undefined, argv.bucket, !argv.noEncryption, arg, uuid, fileSize);
            }
            if (debug) { console.log(reqObj); }
            requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        }
    });
}
function httpUpload(reqObj, callback = () => { }) {
    const options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: '/upload',
        method: reqObj.method,
    }
    let form = undefined;
    if (reqObj.method === 'POST') {
        form = new formData();
    }
    reqObj.readStream.on('end', () => {
        if (debug) { console.log(`Sent ${reqObj.encrypted ? 'encrypted' : 'unencrypted'} ${reqObj.method} from filePath: ${reqObj.filePath}`); }
    });
    if (reqObj.method === 'POST') {
        form.append('fileKey', reqObj.readStream, reqObj.fileName);
        options.headers = form.getHeaders();
    }
    reqObj.req = http.request(options);
    reqObj.req.setHeader('bucket', reqObj.bucket);
    if (reqObj.method === 'PUT') {
        reqObj.req.setHeader('fileName', reqObj.fileName);
    }
    initRequest(reqObj, undefined, callback);
    sendRequest(reqObj, reqObj.method === 'PUT' ? reqObj.readStream : form);
}
async function initMulticastClient() {
    multicastClient.on('error', err => {
        console.error(err);
    })
    multicastClient.on('listening', err => {
        if (err) {console.error(err); return}
        if (debug) {
            console.log(`multicastClient listening on multicast address ${multicastAddr}`);
            console.log('multicastClient bound to address: ', multicastClient.address());
        }
        multicastClient.setBroadcast(true);
        multicastClient.setMulticastTTL(128);
        multicastClient.addMembership(multicastAddr);
    });
    multicastClient.on('message', (message, remote) => {
        if (debug) { console.log('From: ' + remote.address + ':' + remote.port + ' - ' + message) };
        message = message.toString();
        const uuidAndPort = message.slice(1).split(':');
        const uuid = uuidAndPort[0];
        switch (message.charAt(0)) {
            case 'h':
                //validate uuid
                if (validUUID(uuid) && requests[uuid] && !requests[uuid].intervalLock) {
                    const reqObj = requests[uuid];
                    //record information
                    reqObj.hostname = remote.address;
                    reqObj.port = uuidAndPort[1];
                    //temporarily disable multicast messaging
                    reqObj.intervalLock = true;
                    //get file from server claiming to have it
                    httpGet(reqObj, success => {
                        if (success) {
                            //clear uuid interval and delete request
                            clearInterval(reqObj.interval);
                            delete requests[uuid];
                        } else {
                            //keep trying the request
                            reqObj.intervalLock = false;
                        }
                    });
                }
                break;
            case 's':
                if (validUUID(uuid) && requests[uuid] && !requests[uuid].intervalLock) {
                    const reqObj = requests[uuid];
                    //record information
                    reqObj.hostname = remote.address;
                    reqObj.port = uuidAndPort[1];
                    //temporarily disable multicast messaging
                    reqObj.intervalLock = true;
                    //upload file to server claiming to have space
                    httpUpload(reqObj, success => {
                        if (success) {
                            //clear uuid interval
                            clearInterval(reqObj.interval);
                            delete requests[uuid];
                        } else {
                            reqObj.intervalLock = false;
                        }
                    });
                }
                break;
            default:
                break;
        }
    });
    if (debug) {console.log(`Starting multicastClient on port ${multicastPort}`);}
    multicastClient.bind(multicastPort, ipAddr);
}
function sendMulticastMsg(msg = 'this is a sample multicast message (from client)', close = false, targetPort = multicastPort, targetAddr = multicastAddr) {
    const message = new Buffer.from(msg);
    multicastClient.send(message, 0, message.length, targetPort, targetAddr, () => {
        if (close) {
            multicastClient.close();
            if (debug) { console.log('multicastClient closed') }
        }
    });
    if (debug) { console.log("Sent " + message + " to " + targetAddr + ":" + targetPort) }
}
function closeMulticastClient(checkFunction = () => {return true}, timeInterval = attemptTimeout) {
    const closeClient = setInterval(() => {
        if (checkFunction()) {
            multicastClient.close();
            clearInterval(closeClient);
        }
    }, timeInterval);
}
function initRequest(reqObj, getCallback = (success) => {return}, uploadCallback = (success) => {return}) {
    reqObj.req.on('error', err => {
        console.error(err)
    });
    reqObj.req.on('response', res => {
        if (debug) { console.log(`statusCode: ${res.statusCode}`) }
        if (res.statusCode === 200) {
            getCallback(true); 
            uploadCallback(true);
            if (reqObj.method === 'GET') {
                reqObj.writeStream.on('end', () => { //'writeStream' has 'end' event because it is actually a crypto transform stream forwarding to the download file
                    if (debug) { console.log(`File downloaded to ${reqObj.downloadFilePath}`)}
                });
                res.pipe(reqObj.writeStream);
            }
            res.on('data', d => {
                if (debug) { console.log('data: ', d.toString()); }
                if (reqObj.method === 'GET') {
                    logDownload(reqObj, () => {
                        if (debug) { console.log(`file download logged successfully`); }
                    });
                } else if (reqObj.method === 'POST' || reqObj.method === 'PUT') {
                    logUpload(reqObj, d, () => {
                        if (debug) { console.log(`file upload logged successfully`); }
                    });
                }
            });
        } else {
            getCallback(false);
            uploadCallback(false);
        }
    });
}
function sendRequest(reqObj, readStream = null) {
    switch(reqObj.method) {
        case 'GET':
            reqObj.req.end();
            break;
        case 'PUT':
        case 'POST':
            readStream.pipe(reqObj.req);
            break;
        default:
            throw new Error(`${reqObj.method} is an invalid request type`);
            break;
    }
    if (debug) {console.log("Sent ", reqObj.req.method, " request to ", reqObj.req.host, ":", reqObj.port)}
}
function logUpload(reqObj, serverUUID, callback = () => { }) {
    validateLogFile(uploadLogPath, uploadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(uploadLogPath, `${reqObj.method},${reqObj.encrypted},${serverUUID}${reqObj.key}${reqObj.iv},${reqObj.bucket},${today.toISOString()}\n`, callback);
}
function logDownload(reqObj, callback = () => { }) { 
    validateLogFile(downloadLogPath, downloadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(downloadLogPath, `${reqObj.uuid}${reqObj.key}${reqObj.iv},${today.toISOString()}\n`, callback);
}
function validUUID(val) {
    const newVal = val.replace(/-/g, '');
    if (newVal.length !== 32) { return false }
    for (let i = 0; i < newVal.length; i++) {
        const char = newVal.charAt(i);
        if ((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) { continue }
        return false;
    }
    return true;
}
function validateLogFile(path, format) {
    const logDir = path.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        if (debug) {console.log('created logDir path: ' + logDir);}
    }
    if (!fs.existsSync(path)) {
        fs.appendFileSync(path, format.columns.join(',') + '\n');
        console.log('created log file: ' + path);
    }
}
function commandArgsHandler() {
    if (argv.port && typeof argv.port === "string" && argv.port.length > 0) {multicastPort = Number(argv.port)}
    if (argv.bucket !== undefined && !(typeof argv.bucket === "string" && argv.bucket.length > 0)) {argv.bucket = undefined; console.error('Invalid bucket ==> using default');}
    if (argv.outputFiles && typeof argv.outputFiles === "string" && argv.outputFiles.length > 0) {
        let outputFiles = argv.outputFiles.split(',');
        outputFiles.forEach((filePath, idx) => {
            if (filePath.length === 0 || filePath.includes('.') || Buffer.byteLength(filePath) >= maxFileLengthBytes) {
                console.error(`Invalid output file: '${filePath}', using filekey`);
                outputFiles[idx] = undefined;
            }
        });
        argv.outputFiles = outputFiles;
    } else {argv.outputFiles = []}
        
}
function printHelp() {
    console.log("Usage: <command> <param>... [-p, --port=portNumber] [-d, --debug]\n" +
                "      command = GET | PUT | POST\n" +
                "      param = fileKey | filepath\n" +
                "      port (-p): port multicast client binds and sends to\n" +
                "      debug (-d): displays debugging output\n" +
                "\n" +
                "      GET <fileKey>... [-o, --outputFiles=fileName1,...]\n" + //fileKey will contain uuid and aes key and iv
                "      fileKey = string logged after PUT or POST\n" +
                "      outputFiles (-o): names to save downloaded files as (leave empty for default e.g. fileName1,,fileName3)\n" +
                "\n" +
                "      PUT <filepath>... [-b, --bucket=bucket] [-n, --noEncryption]     (POST) is an alias for PUT but uses multipart/form-data\n" +
                "      filepath = path to file for uploading\n" +
                "      bucket (-b): bucket to upload file into\n" +
                "      noEncryption (-n): uploads unencrypted file contents\n"
    );
}
function processArgv(args) {
    let argv = {_: []};
    args.forEach(arg => {
        if (arg.charAt(0) === '-') {
            //flags
            let flag = undefined;
            if (arg.charAt(1) !== '-') {
                switch (arg.charAt(1)) {
                    //match up single dash flags with double dash flags
                    case 'b':
                        flag = 'bucket';
                        break;
                    case 'd':
                        flag = 'debug';
                        break;
                    case 'n':
                        flag = 'noEncryption';
                        break;
                    case 'o':
                        flag = 'outputFiles';
                        break;
                    case 'p':
                        flag = 'port';
                        break;
                    default:
                        break;
                }
            } else {
                flag = arg.slice(2).split('=')[0];
            }
            //assign value to flag or mark it as true
            const params = arg.split('=');
            if (params.length === 2) {
                argv[flag] = params[1];
            } else {
                argv[flag] = true;
            }
        } else {
            //commands
            argv._.push(arg);
        }
    });
    return argv;
}