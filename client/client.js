#!/usr/bin/node

const http = require("http");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const dgram = require("dgram");
const ipAddr = require("ip").address();
const { exit } = require("process");
const { GetRequest, PutRequest } = require("./requests");
const multicastClient = dgram.createSocket({type: "udp4", reuseAddr: true});
const multicastAddr = "230.185.192.108";
const numAttempts = 8; // number of attempts to complete a command (send multicast message)
const attemptTimeout = 200; // milliseconds attempts will wait before trying again
const downloadDir = `${__dirname}/downloads`; //where files downloaded with GET are stored
const uploadLogPath = `${__dirname}/logs/upload_log.csv`; //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime
const uploadLogFormat = {columns: ["method", "encrypted", "fileKey", "bucket", "datetime"]} //used to create log file if missing
const downloadLogPath = `${__dirname}/logs/download_log.csv`; //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime
const downloadLogFormat = {columns: ["uuid","datetime"]} //used to create log file if missing
const maxFileLengthBytes = 255;
const requests = {};


//defaults
let debug = false;
let multicastPort = 5001;

//argv processing
const argv = processArgv(process.argv.slice(2));

//debugging
if (debug) {
    console.log("DEBUG OUTPUT ON");
}

//MAIN CODE
if (debug) { console.log("argv: ", argv) };

if (argv.help || (process.argv.length <= 2 || argv._length <= 0 || argv._[0] == "help")) { // if help or no args
    printHelp();
    exit(0);
}

if (argv._.length > 0) {
    //argsHandler();
    switch (argv._[0].toLowerCase()) {
        case "get":
            get();
            break;
        case "put":
            put();
            break;
        default:
            throw new Error(`Unrecognized command: ${argv._[0]}`)
    }
}

//FUNCTIONS
/**
Main GET function that calls subfunctions to complete the requests. 
It closes the multicast client when finished.
*/
async function get() {
    if (argv._.length < 2) {
        throw new Error("Usage: GET <fileKey> <fileKey2> ...");
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
/**
Iterates through GET command arguments and creates GetRequest objects, 
adding each to the global requests variable. It logs any errors 
encountered when making the objects.
*/
async function getIterThroughArgs(args) {
    args.forEach((arg, idx) => {
        try {
            const reqObj = new GetRequest(arg, () => {sendMulticastMsg("g" + arg.substr(0,32))}, attemptTimeout, numAttempts, downloadDir, argv.outputFiles[idx]);
            if (debug) { console.log(reqObj); }
            requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        } 
    });
}
/**
Initiates and completes a single http GET request based on the parameters 
in the request object.
*/
function httpGet(reqObj, callback = () => {}) {
    const options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: "/download/" + reqObj.uuid,
        method: "GET"
    }
    reqObj.req = http.request(options);
    initRequest(reqObj, callback, undefined);
    sendRequest(reqObj, undefined);
}
/**
Main PUT function that calls subfunctions to complete the requests. 
It closes the multicast client when finished.
*/
async function put() {
    //check arg to see if it is a valid filePath
    if (argv._.length < 2) {
        throw new Error(`Usage: PUT <filePath>...`);
    }
    await initMulticastClient();
    const args = argv._.slice(1);
    await putIterThroughArgs(args);
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
/**
Iterates through PUT command arguments and creates PutRequest objects, 
adding each to the global requests variable. It logs any errors 
encountered when making the objects.
*/
async function putIterThroughArgs(args) {
    args.forEach(arg => {
        try {
            const fileSize = fs.statSync(arg).size + 8;
            const uuid = uuidv4().replace(/-/g, "");
            const reqObj = new PutRequest(arg, () => {sendMulticastMsg("u" + uuid + ":" + fileSize)}, attemptTimeout, numAttempts, argv.bucket, !argv.noEncryption, uuid, fileSize);
            if (debug) { console.log(reqObj); }
            requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        }
    });
}
/**
Initiates and completes a single http PUT request based on the parameters 
in the request object.
*/
function httpPut(reqObj, callback = () => { }) {
    const options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: "/upload",
        method: "PUT",
    }
    reqObj.readStream.on("end", () => {
        if (debug) { console.log(`Sent ${reqObj.encrypted ? "encrypted" : "unencrypted"} PUT from filePath: ${reqObj.filePath}`); }
    });
    reqObj.req = http.request(options);
    if (reqObj.bucket != undefined) {
        reqObj.req.setHeader("bucket", reqObj.bucket);
    }
    reqObj.req.setHeader("fileName", reqObj.fileName);
    initRequest(reqObj, undefined, callback);
    sendRequest(reqObj, reqObj.readStream);
}
/**
Initializes the multicast socket for the client and subscribes
to the address saved in 'multicastAddr'.
*/
async function initMulticastClient() {
    multicastClient.on("error", err => {
        console.error(err);
    })
    multicastClient.on("listening", err => {
        if (err) {console.error(err); return}
        if (debug) {
            console.log("Starting multicast client:", multicastClient.address(), "listening on", multicastAddr);
        }
        multicastClient.setBroadcast(true);
        multicastClient.setMulticastTTL(128);
        multicastClient.addMembership(multicastAddr);
    });
    multicastClient.on("message", (message, remote) => {
        if (debug) { console.log("From: " + remote.address + ":" + remote.port + " - " + message) };
        message = message.toString();
        const uuidAndPort = message.slice(1).split(":");
        const uuid = uuidAndPort[0];
        switch (message.charAt(0)) {
            case "h":
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
                            delete requests[uuid];
                        } else {
                            //keep trying the request
                            reqObj.intervalLock = false;
                        }
                    });
                }
                break;
            case "s":
                if (validUUID(uuid) && requests[uuid] && !requests[uuid].intervalLock) {
                    const reqObj = requests[uuid];
                    //record information
                    reqObj.hostname = remote.address;
                    reqObj.port = uuidAndPort[1];
                    //temporarily disable multicast messaging
                    reqObj.intervalLock = true;
                    //upload file to server claiming to have space
                    httpPut(reqObj, success => {
                        if (success) {
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
    multicastClient.bind(multicastPort, ipAddr);
}
/**
Sends a single multicast message to multicastAddr:multicastPort
*/
function sendMulticastMsg(msg, callback = () => {}) {
    const message = new Buffer.from(msg);
    multicastClient.send(message, 0, message.length, multicastPort, multicastAddr, callback);
    if (debug) { console.log("Sent " + message + " to " + multicastAddr + ":" + multicastPort) }
}
/**
Uses a check function at regular intervals to determine 
whether the multicast connection should be closed. If the 
check function returns true, the connection is closed and
the checking stops.
*/
function closeMulticastClient(checkFunction = () => {return true}, timeInterval = attemptTimeout) {
    const closeClient = setInterval(() => {
        if (checkFunction()) {
            multicastClient.close();
            clearInterval(closeClient);
        }
    }, timeInterval);
}
/**
Initializes a single http request and determines the program's
actions upon receiving a response. For GET requests, it 
downloads the file sent and logs it. For PUT requests, it 
logs a successful upload.
*/
function initRequest(reqObj, getCallback = (success) => {return}, putCallback = (success) => {return}) {
    reqObj.req.on("error", err => {
        console.error(err)
    });
    reqObj.req.on("response", res => {
        if (debug) { console.log(`Status code: ${res.statusCode}`) }
        if (res.statusCode === 200) {
            if (reqObj.method === "GET") {
                reqObj.writeStream.on("finish", () => { 
                    if (debug) { console.log(`File downloaded to ${reqObj.downloadFilePath}`)}
                    reqObj.end();
                });
                res.pipe(reqObj.writeStream);
            } else {
                //successfully uploaded a file
                reqObj.end();
            }
            res.on("data", d => {
                if (debug) { console.log("Data: ", d.toString()); }
                if (reqObj.method === "GET") {
                    logDownload(reqObj, () => {
                        if (debug) { console.log("File download logged successfully"); }
                    });
                } else if (reqObj.method === "PUT") {
                    reqObj.fileKey = `${d}${reqObj.key}${reqObj.iv}`;
                    logUpload(reqObj, () => {
                        if (debug) { console.log("File upload logged successfully"); }
                    });
                } else {
                    throw new Error("Unknown request type: " + reqObj.method)
                }
            });
            getCallback(true); 
            putCallback(true);
        } else {
            getCallback(false);
            putCallback(false);
        }
    });
}
/**
Sends an initialized http request based on its type.
GET requests can just be end()ed, whereas PUT
requests have their upload file's contents piped to
the request object.
*/
function sendRequest(reqObj, readStream = null) {
    switch(reqObj.method) {
        case "GET":
            reqObj.req.end();
            break;
        case "PUT":
            readStream.pipe(reqObj.req);
            break;
        default:
            throw new Error("Unknown request type: " + reqObj.method);
            break;
    }
    if (debug) {console.log("Sent ", reqObj.req.method, " request to ", reqObj.req.host, ":", reqObj.port)}
}
/**
Logs a successful upload based on the parameters in the request
object and the UUID returned by the server.
*/
function logUpload(reqObj, callback = () => { }) {
    validateLogFile(uploadLogPath, uploadLogFormat, () => {
        const today = new Date(Date.now());
        fs.appendFile(uploadLogPath, `PUT,${reqObj.encrypted},${reqObj.fileKey},${reqObj.bucket},${today.toISOString()}\n`, callback);    
    });
}
/**
Logs a successful download based on the parameters in the request
object.
*/
function logDownload(reqObj, callback = () => { }) { 
    validateLogFile(downloadLogPath, downloadLogFormat, () => {
        const today = new Date(Date.now());
        fs.appendFile(downloadLogPath, `${reqObj.fileKey},${today.toISOString()}\n`, callback);
    });
}
/**
Returns true if the provided value is a valid UUID.
Returns false if otherwise.
*/
function validUUID(val) {
    const newVal = val.replace(/-/g, "");
    if (newVal.length !== 32) { return false }
    for (let i = 0; i < newVal.length; i++) {
        const char = newVal.charAt(i);
        if ((char >= "0" && char <= "9") || (char >= "a" && char <= "f")) { continue }
        return false;
    }
    return true;
}
/**
Ensures that the provided path to the log file exists,
creating the file based on the format argument if
necessary.
*/
function validateLogFile(path, format, callback = () => { }) {
    const logDir = path.split("/").slice(0, -1).join("/");
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        if (debug) {console.log("Created log dir: " + logDir);}
    }
    if (!fs.existsSync(path)) {
        fs.appendFileSync(path, format.columns.join(",") + "\n");
        console.log("Created log file: " + path);
    }
    callback();
}
/**
Prints the help message.
*/
function printHelp() {
    console.log("Usage: <command> <param>... [-p, --port=portNumber] [-d, --debug]\n" +
                "      command = GET | PUT\n" +
                "      param = fileKey | filepath\n" +
                "      port (-p): port multicast client binds and sends to\n" +
                "      debug (-d): displays debugging output\n" +
                "\n" +
                "      GET <fileKey>... [-o, --outputFiles=fileName1,...]\n" + //fileKey will contain uuid and aes key and iv
                "      fileKey = file identifier; found in log file after uploading with PUT\n" +
                "      outputFiles (-o): names to save downloaded files as (leave empty for default e.g. fileName1,,fileName3)\n" +
                "\n" +
                "      PUT <filepath>... [-b, --bucket=bucket] [-n, --noEncryption]\n" +
                "      filepath = path to file for uploading\n" +
                "      bucket (-b): bucket to upload file into\n" +
                "      noEncryption (-n): uploads unencrypted file contents\n"
    );
}
/**
Parses the process arguments and creates an argv 
variable containing argument data. Changes global 
variables based on the arguments passed in.
*/
function processArgv(args) {
    let argv = {
        _: [],
        outputFiles: [],
    };
    error = null;
    args.forEach(arg => {
        if (error) {
            throw new Error("Invalid parameter: " + error);
        }
        [symbol, params] = arg.split("=");
        switch(symbol) {
            // flags
            case "--help":
                argv.help = true;
                break;
            case "-d":
            case "--debug":
                if (params == undefined) {debug = true}
                else {error = arg}
                break;
            case "-n":
            case "--noEncryption":
                if (params == undefined) {argv.noEncryption = true}
                else {error = arg}
                break;
            
            
            // args
            case "-p":
            case "--port":
                if (params && !isNaN(params)) {multicastPort = Number(params)}
                else {error = arg}
                break;
            case "-o":
            case "--outputFiles":
                if (params) {argv.outputFiles = params.split(",")}
                else {error = arg}
                break;
            case "-b":
            case "--bucket":
                if (params) {argv.bucket = params}
                else {error = arg}
                break;

            // command or command arg
            default:
                if (!symbol.startsWith("-")) {argv._.push(symbol)} 
                else {error = arg}
        }
    });
    if (error) {
        throw new Error("Invalid parameter: " + error);
    }
    return argv;
}