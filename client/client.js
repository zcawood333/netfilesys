#!/usr/bin/node

const argv = processArgv(process.argv.slice(2));
const http = require('http');
const crypto = require('crypto');
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
const getDownloadPath = `${__dirname}/downloads/`; //where files from GET are stored
const tempFilePath = `${__dirname}/tmp/`; //temporary spot for encrypted files
const uploadLogPath = `${__dirname}/logs/upload_log.csv`; //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime
const uploadLogFormat = {columns: ['method', 'encrypted', 'fileKey', 'datetime']} //used to create log file if missing
const downloadLogPath = `${__dirname}/logs/download_log.csv`; //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime
const downloadLogFormat = {columns: ['uuid','datetime']} //used to create log file if missing
const maxFileLengthBytes = 255;
const { GetRequest, PutRequest, PostRequest } = require('./requests');

//command based implementation defaults
let requests = {};
let multicastPort = 5001;


//flag-based implementation defaults
let tcpServerPort = 5000;
let tcpServerHostname = '192.168.1.43';
let path = '';
let method = 'GET';
let fpath = null;


//testing
let debug = false;
if (argv.debug) {
    debug = true;
    console.log('DEBUG OUTPUT ON');
}

//MAIN CODE
if (debug) { console.log('argv: ', argv) };

if (argv.help || (process.argv.length <= 2 || argv._[0] == 'help')) { // if help or no args
    printHelp();
    exit(0);
}

if (argv._.length > 0) {
    //command based
    commandArgsHandler();
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
    //flag based, old implementation; probably needs cleaned up eventually
    if (argv.multicast) {
        //send a multicast message and close the connection
        initMulticastClient();
        sendMulticastMsg(argv.multicast, true, argv.port, argv.hostname);
    } else {
        //send a http request
        //argv handling and error checking
        flagArgsHandler();
        //create http request
        const options = {
            hostname: tcpServerHostname,
            port: tcpServerPort,
            path: path,
            method: 'GET',
        }
        //make POST-specific changes
        let form = undefined;
        if (method === 'POST') {
            form = new formData();
            changeMethodToPost(options, form);
        }
        const req = http.request(options);
        //init req event listeners
        const uuid = path.split('/').slice(-1)[0];
        initRequest(req, method === 'GET', { downloadFileName: uuid, serverUUID: uuid });
        //send request
        sendRequest(req, method === 'POST', { readStream: form }, options.port);
    }
}

//FUNCTIONS
async function GET() {
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
    args.forEach(arg => {
        try {
            const reqObj = new GetRequest(() => {sendMulticastMsg('g' + arg.substr(0,32))}, 200, 8, undefined, undefined, undefined, arg);
            if (debug) { console.log(reqObj); }
            requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        } 
    });
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
function httpGet(reqObj, callback = () => {}) {
    const options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: '/download/' + reqObj.uuid,
        method: 'GET'
    }
    reqObj.req = http.request(options);
    if (argv.outputFile && 
        typeof argv.outputFile === "string" && 
        argv.outputFile.length > 0 &&
        !argv.outputFile.includes('.') &&
        Buffer.byteLength(argv.outputFile) < maxFileLengthBytes) {reqObj.downloadFileName = argv.outputFile}
    initRequest(reqObj, callback, undefined);
    sendRequest(reqObj, undefined);
}
async function PUT() {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error('Usage: PUT <filePath>...');
    }
    await initMulticastClient();
    const args = argv._.slice(1);
    await uploadIterThroughArgs(args, false);
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
async function POST() {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error('Usage: POST <filePath>...');
    }
    await initMulticastClient();
    const args = argv._.slice(1);
    await uploadIterThroughArgs(args, true);
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
                reqObj = new PostRequest(() => {sendMulticastMsg('u' + uuid + ':' + fileSize)}, 200, 8, undefined, undefined, undefined, argv.bucket, !argv.noEncryption, arg, uuid, fileSize);
            } else {
                reqObj = new PutRequest(() => {sendMulticastMsg('u' + uuid + ':' + fileSize)}, 200, 8, undefined, undefined, undefined, argv.bucket, !argv.noEncryption, arg, uuid, fileSize);
            }
            if (debug) { console.log(reqObj); }
            requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        }
    });
}
function httpUpload(reqObj, readPath, callback = () => { }) {
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
    let uploadFile = undefined;
    try {
        uploadFile = fs.createReadStream(readPath);
        uploadFile.on('error', err => {
            console.error(err);
        });
        uploadFile.on('end', () => {
            if (debug) { console.log(`Sent ${reqObj.method} request reading from path: ${readPath}`); }
            uploadFile.close();
        });
    } catch {
        if (debug) { console.log(`Unable to read file path: ${readPath}`); }
        return;
    }
    if (reqObj.method === 'POST') {
        form.append('fileKey', uploadFile);
        options.headers = form.getHeaders();
    }
    reqObj.req = http.request(options);
    reqObj.req.setHeader('bucket', reqObj.bucket);
    if (reqObj.method === 'PUT') {
        const fileName = readPath.split('/').slice(-1)[0];
        reqObj.req.setHeader('fileName', fileName);
    }
    initRequest(reqObj, undefined, callback);
    sendRequest(reqObj, reqObj.method === 'PUT' ? uploadFile : form);
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
                    if (reqObj.encrypted) {
                        const encryptedFilePath = `${tempFilePath}${reqObj.key}`;
                        aesEncrypt(reqObj.filePath, encryptedFilePath, reqObj.key, reqObj.iv, () => {
                            httpUpload(reqObj, encryptedFilePath, success => {
                                fs.rm(encryptedFilePath, () => {
                                    if (debug) { console.log(`temp file: ${encryptedFilePath} removed`); }
                                });
                                if (success) {
                                    //clear uuid interval
                                    clearInterval(reqObj.interval);
                                    delete requests[uuid];
                                } else {
                                    reqObj.intervalLock = false;
                                }
                            });
                        });
                    } else {
                        httpUpload(reqObj, reqObj.filePath, success => {
                            if (success) {
                                //clear uuid interval
                                clearInterval(reqObj.interval);
                                delete requests[uuid];
                            } else {
                                reqObj.intervalLock = false;
                            }
                        });
                    }
                }
                break;
            default:
                break;
        }
    });
    if (debug) {console.log(`Starting multicastClient on port ${multicastPort}`);}
    multicastClient.bind(multicastPort, ipAddr);
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
                //save file under ./getDownloadPath/downloadFileName, and if the path doesn't exist, create the necessary directories
                let path;
                if (reqObj.encrypted) { path = `${tempFilePath}${reqObj.downloadFileName}` } //path goes to a temp file first to get decrypted
                else { path = `${getDownloadPath}${reqObj.downloadFileName}`} //path is direct to download file
                if (debug) { console.log(`path: ${path}`) }
                validateDirPath(path.split('/').slice(0,-1).join('/'));
                const writeStream = fs.createWriteStream(path);
                writeStream.on('finish', () => {
                    if (reqObj.encrypted) {
                        aesDecrypt(path, `${getDownloadPath}${reqObj.downloadFileName}`, reqObj.key, reqObj.iv, () => {
                            fs.rm(path, () => {
                                if (debug) { console.log(`temp file: ${path} removed`); }
                            });
                            if (debug) { console.log(`file downloaded to ${getDownloadPath}${reqObj.downloadFileName}`); }
                        });
                    }
                    writeStream.close();
                });
                res.pipe(writeStream);
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
function logUpload(reqObj, serverUUID, callback = () => { }) {
    validateLogFile(uploadLogPath, uploadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(uploadLogPath, `${reqObj.method},${reqObj.encrypted},${serverUUID}${reqObj.key}${reqObj.iv},${today.toISOString()}\n`, callback);
}
function logDownload(reqObj, callback = () => { }) { 
    validateLogFile(downloadLogPath, downloadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(downloadLogPath, `${reqObj.uuid}${reqObj.key}${reqObj.iv},${today.toISOString()}\n`, callback);
}
function validateLogFile(path, format) {
    const logDir = path.split('/').slice(0, -1).join('/');
    validateDirPath(logDir);
    if (!fs.existsSync(path)) {
        fs.appendFileSync(path, format.columns.join(',') + '\n');
        console.log('created log file: ' + path);
    }
}
function validateDirPath(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        if (debug) {console.log('created dir path: ' + dirPath);}
    }
}
function aesDecrypt(encryptedFilePath, unencryptedFilePath, key, iv, callback = () => { }) {
    //decrypts file at old path using key, writes it to new file path
    if (debug) {
        console.log(`key: ${key}`);
        console.log(`iv: ${iv}`);
    }
    //assumes the old file path exists
    const unencryptedFileDir = unencryptedFilePath.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(unencryptedFileDir)) { fs.mkdirSync(unencryptedFileDir, { recursive: true }) };
    const readStream = fs.createReadStream(encryptedFilePath);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const writeStream = fs.createWriteStream(unencryptedFilePath);
    readStream.on('error', err => {
        console.error(err);
    });
    decipher.on('error', err => {
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
    readStream.pipe(decipher).pipe(writeStream);
}
function aesEncrypt(unencryptedFilePath, encryptedFilePath, key, iv, callback = () => { }) {
    //encrypts file at old path using key, writes it to new file path
    if (debug) {
        console.log(`key: ${key}`);
        console.log(`iv: ${iv}`);
    }
    //assumes the old file path exists
    const encryptedFileDir = encryptedFilePath.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(encryptedFileDir)) { fs.mkdirSync(encryptedFileDir, { recursive: true }) };
    const readStream = fs.createReadStream(unencryptedFilePath);
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
function closeMulticastClient(checkFunction = () => {return true}, timeInterval = attemptTimeout) {
    const closeClient = setInterval(() => {
        if (checkFunction()) {
            multicastClient.close();
            clearInterval(closeClient);
        }
    }, timeInterval);
}
function commandArgsHandler() {
    if (argv.port && typeof argv.port === "string" && argv.port.length > 0) {multicastPort = Number(argv.port)}
    if (argv.bucket !== undefined && !(typeof argv.bucket === "string" && argv.bucket.length > 0)) {argv.bucket = undefined; console.error('Invalid bucket ==> using default');}
}
function flagArgsHandler() {
    if (argv.hostname) { tcpServerHostname = argv.hostname };
    if (argv.path) { path = argv.path };
    if (argv.port) { tcpServerPort = argv.port };
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
function printHelp() {
    console.log("Usage: <command> <param>... [--port=portNumber] [--debug]\n" +
                "      command = GET | PUT | POST\n" +
                "      param = fileKey | filepath\n" +
                "      port: port multicast client binds and sends to\n" +
                "      debug: displays debugging output\n" +
                "\n" +
                "      GET <fileKey>... [--outputFile=fileName]\n" + //fileKey will contain uuid and aes key and iv
                "      fileKey = string logged after PUT or POST\n" +
                "      outputFile: downloaded file save name\n" +
                "\n" +
                "      PUT <filepath>... [--noEncryption]     (POST) is an alias for PUT but uses multipart/form-data\n" +
                "      filepath = path to file for uploading\n" +
                "      noEncryption: uploads unencrypted file contents\n" +
                "\n" +
                "Deprecated usage: --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=... \n"
    );
}
function processArgv(args) {
    let argv = {_: []};
    args.forEach(arg => {
        switch (arg.charAt(0)) {
            case '-':
                switch (arg.charAt(1)) {
                    case '-':
                        const param = arg.slice(2);
                        if (param.split('=').length === 2) {
                            argv[param.split('=')[0]] = param.split('=')[1];
                        } else {
                            argv[param] = true;
                        }
                        break;
                    default:
                        //no single dash args implemented
                        break;
                }
                break;
            default:
                argv._.push(arg);
        }
    });
    return argv;
}