#!/usr/local/bin/node

const argv = processArgv(process.argv.slice(2));
const http = require('http');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const formData = require('form-data');
const fs = require('fs');
const dgram = require('dgram');
const multicastClient = dgram.createSocket({type: 'udp4', reuseAddr: true});
const multicastAddr = '230.185.192.108';
const multicastPort = 5001;
const { exit } = require('process');
const numGetAttempts = 8; // number of attempts to GET a file
const getAttemptTimeout = 200; // milliseconds GET attempt will wait before trying again
const getDownloadPath = `${__dirname}/downloads/`; //where files from GET are stored
const tempFilePath = `${__dirname}/tmp/`; //temporary spot for encrypted files
const uploadLogPath = `${__dirname}/logs/upload_log.csv`; //stores method, encryption (bool), filekeys (serverUUID + clientKey + clientIV), and the datetime
const uploadLogFormat = {columns: ['method', 'encrypted', 'filekey', 'datetime']} //used to create log file if missing
const downloadLogPath = `${__dirname}/logs/download_log.csv`; //stores filekeys (serverUUID + clientKey + clientIV) and the datetime
const downloadLogFormat = {columns: ['uuid','datetime']} //used to create log file if missing
const maxFileLengthBytes = 255;

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
if (debug) { console.log('argv: ', argv) };

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
        const uuid = path.split('/').slice(-1)[0];
        initRequest(req, method === 'GET', { downloadFileName: uuid, serverUUID: uuid });
        //send request
        sendRequest(req, method === 'POST', { readStream: form });
    }
}

//FUNCTIONS
async function GET() {
    if (argv._.length < 2) {
        throw new Error('Usage: GET <filekey> <filekey2> ...');
    }
    await initMulticastClient();
    const args = argv._.slice(1);
    await getIterThroughArgs(args);
    const closeClient = setInterval(() => {
        if (Object.keys(getIntervals).length === 0) {
            multicastClient.close();
            clearInterval(closeClient);
        }
    }, getAttemptTimeout);
}
async function getIterThroughArgs(args) {
    args.forEach(arg => {
        if (debug) { console.log(`current arg: ${arg}`); }
        let key = '';
        let iv = '';
        if (arg.length > 32) {
            const filekey = arg;
            arg = filekey.substr(0, 32);
            const keyIV = filekey.slice(32);
            key = keyIV.substr(0, 32);
            iv = keyIV.slice(32);
            if (!validUUID(key)) {
                if (debug) { console.log(`filekey: ${filekey} is invalid`); }
                return;
            }
        }
        if (validUUID(arg)) {
            const uuid = arg.replace(/-/g, '');
            getIntervals[uuid] = {
                interval: setInterval(() => {
                    if (getIntervals[uuid]['attempts'] < numGetAttempts) {
                        sendMulticastMsg('g' + uuid);
                        getIntervals[uuid]['attempts']++;
                    } else {
                        if (debug) { console.log(`file with uuid: ${uuid} not found`); }
                        if (debug) { console.log(`now deleting interval for uuid: ${uuid}`); }
                        clearInterval(getIntervals[uuid]['interval']);
                        delete getIntervals[uuid];
                    }
                }, getAttemptTimeout),
                attempts: 0,
                key: key,
                iv: iv,
            }
        } else {
            if (debug) { console.log(`arg: ${arg} is not a valid uuid`); }
        }
    });
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
        switch (message.charAt(0)) {
            case 'h':
                //validate uuid
                const uuidAndPort = message.slice(1).split(':');
                const uuid = uuidAndPort[0];
                const port = uuidAndPort[1];
                if (validUUID(uuid) && getIntervals[uuid]) {
                    //record key and iv
                    const key = getIntervals[uuid]['key'];
                    const iv = getIntervals[uuid]['iv'];
                    //clear uuid interval
                    clearInterval(getIntervals[uuid]['interval']);
                    delete getIntervals[uuid];
                    //get file from server claiming to have it
                    httpGet(remote.address, port, uuid, key, iv);
                }

                break;
            default:
                break;
        }
    });
    if (debug) {console.log(`Starting multicastClient on port ${multicastPort}`);}
    multicastClient.bind(multicastPort, '192.168.1.43');
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
function httpGet(hostname = tcpServerHostname, port = tcpServerPort, fileUUID, key = '', iv = '') {
    const options = {
        hostname: hostname,
        port: port,
        path: '/download/' + fileUUID,
        method: 'GET'
    }
    const req = http.request(options);
    let downloadFileName = fileUUID + key + iv;
    if (argv.outputFile && 
        typeof argv.outputFile === "string" && 
        argv.outputFile.length > 0 &&
        !argv.outputFile.includes('.') &&
        Buffer.byteLength(argv.outputFile) < maxFileLengthBytes) {downloadFileName = argv.outputFile}
    initRequest(req, true, { downloadFileName: downloadFileName, serverUUID: fileUUID }, false, false, key, iv);
    sendRequest(req, undefined, undefined, port);
}
function PUT(encrypt) {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error('Usage: PUT <filePath>...');
    }
    const args = argv._.slice(1);
    args.forEach(arg => {
        const filePath = arg;
        if (fs.existsSync(filePath)) {
            if (encrypt) {
                const uuid = uuidv4().replace(/-/g, '');
                const iv = crypto.randomBytes(8).toString('hex');
                const encryptedFilePath = `${tempFilePath}${uuid}`;
                aesEncrypt(filePath, encryptedFilePath, uuid, iv, () => {
                    httpPut(tcpServerHostname, tcpServerPort, encryptedFilePath, uuid, iv, () => {
                        fs.rm(encryptedFilePath, () => {
                            if (debug) { console.log(`temp file: ${encryptedFilePath} removed`); }
                        });
                    });
                });
            } else {
                httpPut(tcpServerHostname, tcpServerPort, filePath);
            }
        } else {
            if (debug) { console.log(`filepath: ${filePath} does not exist`); }
        }
    });
}
function httpPut(hostname = tcpServerHostname, port = tcpServerPort, filePath, key = '', iv = '', callback = () => { }) {
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
        if (debug) { console.log(`Unable to read file path: ${filePath}`); }
        return;
    }
    const req = http.request(options);
    initRequest(req, false, undefined, false, true, key, iv);
    putFile.on('error', err => {
        console.error(err);
    });
    putFile.on('end', () => {
        if (debug) { console.log(`Sent PUT request with path: ${filePath}`); }
        putFile.close();
        callback();

    });
    sendRequest(req, true, { readStream: putFile });
}
function POST(encrypt) {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error('Usage: POST <filePath>...');
    }
    const args = argv._.slice(1);
    args.forEach(arg => {
        const filePath = arg;
        if (fs.existsSync(filePath)) {
            if (encrypt) {
                const uuid = uuidv4().replace(/-/g, '');
                const iv = crypto.randomBytes(8).toString('hex');
                const encryptedFilePath = `${tempFilePath}${uuid}`;
                aesEncrypt(filePath, encryptedFilePath, uuid, iv, () => {
                    httpPost(tcpServerHostname, tcpServerPort, encryptedFilePath, uuid, iv, () => {
                        fs.rm(encryptedFilePath, () => {
                            if (debug) { console.log(`temp file: ${encryptedFilePath} removed`); }
                        });
                    });
                });
            } else {
                httpPost(tcpServerHostname, tcpServerPort, filePath);
            }
        } else {
            if (debug) { console.log(`filePath: ${filePath} does not exist`); }
        }
    });
}
function httpPost(hostname = tcpServerHostname, port = tcpServerPort, filePath, key = '', iv = '', callback = () => { }) {
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
        if (debug) { console.log(`Unable to read file path: ${filePath}`); }
        return;
    }
    postFile.on('error', err => {
        console.error(err);
    });
    postFile.on('end', () => {
        if (debug) { console.log(`Sent POST request with path: ${filePath}`); }
        postFile.close();
        callback();
    });
    form.append('fileKey', postFile);
    options.headers = form.getHeaders();
    //create request
    const req = http.request(options);
    initRequest(req, false, undefined, true, false, key, iv);
    //send request
    sendRequest(req, true, { readStream: form });
}
function initRequest(req, GET = false, getOptions = { downloadFileName: 'downloadFile', serverUUID: 'undefined' }, POST = false, PUT = false, key = '', iv = '') {
    req.on('error', err => {
        console.error(err)
    });
    req.on('response', res => {
        if (debug) { console.log(`statusCode: ${res.statusCode}`) }
        if (GET) {
            //save file under ./getDownloadPath/downloadFileName, and if the path doesn't exist, create the necessary directories
            let path;
            if (key != '') { path = `${tempFilePath}${getOptions.downloadFileName}` }
            else { path = `${getDownloadPath}${getOptions.downloadFileName}`}
            if (debug) { console.log(`path: ${path}`) }
            validateDirPath(path.split('/').slice(0,-1).join('/'));
            const writeStream = fs.createWriteStream(path);
            writeStream.on('finish', () => {
                if (key != '') {
                    aesDecrypt(path, `${getDownloadPath}${getOptions.downloadFileName}`, key, iv, () => {
                        fs.rm(path, () => {
                            if (debug) { console.log(`temp file: ${path} removed`); }
                        });
                        if (debug) { console.log(`file downloaded to ${getDownloadPath}${getOptions.downloadFileName}`); }
                    });
                }
                writeStream.close();
            });
            res.pipe(writeStream);
        }
        res.on('data', d => {
            if (debug) { console.log('data: ', d.toString()); }
            if (GET) {
                logDownload(getOptions.serverUUID, key, iv, () => {
                    if (debug) { console.log(`file download logged successfully`); }
                });
            } else if (POST || PUT) {
                logUpload(POST ? 'POST' : 'PUT', d, key, iv, () => {
                    if (debug) { console.log(`file upload logged successfully`); }
                });
            }
        });
    });
}
function logUpload(method = 'undefined', serverUUID, clientKey, iv, callback = () => { }) {
    validateLogFile(uploadLogPath, uploadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(uploadLogPath, `${method},${clientKey != ''},${serverUUID}${clientKey}${iv},${today.toISOString()}\n`, callback);
}
function logDownload(serverUUID, clientKey, iv, callback = () => { }) { 
    validateLogFile(downloadLogPath, downloadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(downloadLogPath, `${serverUUID}${clientKey}${iv},${today.toISOString()}\n`, callback);
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
function sendRequest(req, piped = false, pipedOptions = { readStream: undefined }, port = 'unknown') {
    if (piped) {
        //request end is implicit after piping
        pipedOptions.readStream.pipe(req);
    } else {
        req.end();
    }
    if (debug) {console.log("Sent ", req.method, " request to ", req.host, ":", port)}
}
function argsHandler() {
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
    console.log("Usage: <command> <param>... [--debug] [--noEncryption]\n" +
        " --method=[g,get,p,post], --hostname=..., --port=..., --path=..., --fpath=... \n" +
        "    command = GET | PUT | POST\n" +
        "      GET <filekey>... [--outputFile=fileName]\n" + //filekey will contain uuid and aes key and iv
        "      PUT <filepath>...      (POST) is an alias for PUT but does multipart\n" +
        "      \n"
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