#!/usr/bin/node

const http = require("http");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const dgram = require("dgram");
const ipAddr = require("ip").address();
const { GetRequest, PutRequest } = require("./requests");
const multicastClient = dgram.createSocket({type: "udp4", reuseAddr: true});
const uploadLogFormat = {columns: ["method", "encrypted", "fileKey", "bucket", "datetime"]} //used to create log file if missing
const downloadLogFormat = {columns: ["uuid","datetime"]} //used to create log file if missing


class NetfilesysClient {
    static initialized = false;
    static multicastAddr = null;
    static multicastPort = null;
    static numAttempts = null; // number of attempts to complete a command (send multicast message)
    static attemptTimeout = null; // milliseconds attempts will wait before trying again
    static downloadDir = null; //where files downloaded with GET are stored
    static uploadLogPath = null; //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime
    static downloadLogPath = null; //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime
    static debug = null;
    static requests = {};
    //FUNCTIONS
    /**
    Initializes the multicast socket for the client and subscribes
    to the address saved in 'multicastAddr'. Also initializes any
    class variables specified in parameters.
    */
    static async init(  multicastAddr = "230.185.192.108", 
                        multicastPort = 5001,
                        numAttempts = 8,
                        attemptTimeout = 200,
                        downloadDir = `${__dirname}/downloads`,
                        uploadLogPath = `${__dirname}/logs/upload_log.csv`,
                        downloadLogPath = `${__dirname}/logs/download_log.csv`,
                        debug = false) {
        this.multicastAddr = multicastAddr;
        this.multicastPort = multicastPort;
        this.numAttempts = numAttempts; // number of attempts to complete a command (send multicast message)
        this.attemptTimeout = attemptTimeout; // milliseconds attempts will wait before trying again
        this.downloadDir = downloadDir; //where files downloaded with GET are stored
        this.uploadLogPath = uploadLogPath; //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime
        this.downloadLogPath = downloadLogPath; //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime
        this.debug = debug;
        if (this.debug) {console.log("DEBUG OUTPUT ON")}
        multicastClient.on("error", err => {
            console.error(err);
        })
        multicastClient.on("listening", err => {
            if (err) {console.error(err); return}
            if (this.debug) {
                console.log("Starting multicast client:", multicastClient.address(), "listening on", this.multicastAddr);
            }
            multicastClient.setBroadcast(true);
            multicastClient.setMulticastTTL(128);
            multicastClient.addMembership(this.multicastAddr);
            Object.keys(this.requests).forEach(key => {
                this.requests[key].intervalLock = false;
            }); // if any requests were initialized before init(), they were locked, so unlock them
            this.initialized = true;
        });
        multicastClient.on("message", (message, remote) => {
            if (this.debug) { console.log("From: " + remote.address + ":" + remote.port + " - " + message) };
            message = message.toString();
            const uuidAndPort = message.slice(1).split(":");
            const uuid = uuidAndPort[0];
            switch (message.charAt(0)) {
                case "h":
                    //validate uuid
                    if (this._validUUID(uuid) && this.requests[uuid] && !this.requests[uuid].intervalLock) {
                        const reqObj = this.requests[uuid];
                        //record information
                        reqObj.hostname = remote.address;
                        reqObj.port = uuidAndPort[1];
                        //temporarily disable multicast messaging
                        reqObj.intervalLock = true;
                        //get file from server claiming to have it
                        this._httpGet(reqObj, success => {
                            if (success) {
                                delete this.requests[uuid];
                            } else {
                                //keep trying the request
                                reqObj.intervalLock = false;
                            }
                        });
                    }
                    break;
                case "s":
                    if (this._validUUID(uuid) && this.requests[uuid] && !this.requests[uuid].intervalLock) {
                        const reqObj = this.requests[uuid];
                        //record information
                        reqObj.hostname = remote.address;
                        reqObj.port = uuidAndPort[1];
                        //temporarily disable multicast messaging
                        reqObj.intervalLock = true;
                        //upload file to server claiming to have space
                        this._httpPut(reqObj, success => {
                            if (success) {
                                delete this.requests[uuid];
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
        multicastClient.bind(this.multicastPort, ipAddr);
    }
    /**
    Main PUT function that creates a PutRequest object. 
    */
    static async put(arg, bucket = 'std', encryption = true) {
        try {
            const fileSize = fs.statSync(arg).size + 8;
            const uuid = uuidv4().replace(/-/g, "");
            const reqObj = new PutRequest(arg, () => {this._sendMulticastMsg("u" + uuid + ":" + fileSize)}, this.attemptTimeout, this.numAttempts, bucket, encryption, uuid);
            if (!this.initialized) {reqObj.intervalLock = true}
            if (this.debug) { console.log(reqObj); }
            this.requests[reqObj.uuid] = reqObj;
        } catch(err) {
            throw new Error('NetFileSys put request failed', err)
        }
    }
    /**
    Main GET function that creates a GetRequest object.
    */
    static async get(arg, outputFile) {
        try {
            const reqObj = new GetRequest(arg, () => {this._sendMulticastMsg("g" + arg.substr(0,32))}, this.attemptTimeout, this.numAttempts, this.downloadDir, outputFile);
            if (!this.initialized) {reqObj.intervalLock = true}
            if (this.debug) { console.log(reqObj); }
            this.requests[reqObj.uuid] = reqObj;
        } catch(err) {
            return console.error(err);
        } 
    }
    /**
    Closes the multicast client connection.
    */
    static close() {
        multicastClient.close();
    }
    /**
    Initiates and completes a single http GET request based on the parameters 
    in the request object.
    */
    static _httpGet(reqObj, callback = () => {}) {
        const options = {
            hostname: reqObj.hostname,
            port: reqObj.port,
            path: "/download/" + reqObj.uuid,
            method: "GET"
        }
        reqObj.req = http.request(options);
        this._initRequest(reqObj, callback, undefined);
        this._sendRequest(reqObj, undefined);
    }
    /**
    Initiates and completes a single http PUT request based on the parameters 
    in the request object.
    */
    static _httpPut(reqObj, callback = () => { }) {
        const options = {
            hostname: reqObj.hostname,
            port: reqObj.port,
            path: "/upload",
            method: "PUT",
        }
        reqObj.readStream.on("end", () => {
            if (this.debug) { console.log(`Sent ${reqObj.encrypted ? "encrypted" : "unencrypted"} PUT from filePath: ${reqObj.filePath}`); }
        });
        reqObj.req = http.request(options);
        if (reqObj.bucket != undefined) {
            reqObj.req.setHeader("bucket", reqObj.bucket);
        }
        reqObj.req.setHeader("fileName", reqObj.fileName);
        this._initRequest(reqObj, undefined, callback);
        this._sendRequest(reqObj, reqObj.readStream);
    }
    /**
    Sends a single multicast message to multicastAddr:multicastPort
    */
    static _sendMulticastMsg(msg, callback = () => {}) {
        const message = new Buffer.from(msg);
        multicastClient.send(message, 0, message.length, this.multicastPort, this.multicastAddr, callback);
        if (this.debug) { console.log("Sent " + message + " to " + this.multicastAddr + ":" + this.multicastPort) }
    }
    /**
    Initializes a single http request and determines the program's
    actions upon receiving a response. For GET requests, it 
    downloads the file sent and logs it. For PUT requests, it 
    logs a successful upload.
    */
    static _initRequest(reqObj, getCallback = (success) => {return}, putCallback = (success) => {return}) {
        reqObj.req.on("error", err => {
            console.error(err)
        });
        reqObj.req.on("response", res => {
            if (this.debug) { console.log(`Status code: ${res.statusCode}`) }
            if (res.statusCode === 200) {
                if (reqObj.method === "GET") {
                    reqObj.writeStream.on("finish", () => { 
                        if (this.debug) { console.log(`File downloaded to ${reqObj.downloadFilePath}`)}
                        reqObj.end();
                    });
                    res.pipe(reqObj.writeStream);
                } else {
                    //successfully uploaded a file
                    reqObj.end();
                }
                res.on("data", d => {
                    if (this.debug) { console.log("Data: ", d.toString()); }
                    if (reqObj.method === "GET") {
                        this._logDownload(reqObj, () => {
                            if (this.debug) { console.log("File download logged successfully"); }
                        });
                    } else if (reqObj.method === "PUT") {
                        reqObj.fileKey = `${d}${reqObj.key}${reqObj.iv}`;
                        this._logUpload(reqObj, () => {
                            if (this.debug) { console.log("File upload logged successfully"); }
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
    static _sendRequest(reqObj, readStream = null) {
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
        if (this.debug) {console.log("Sent ", reqObj.req.method, " request to ", reqObj.req.host, ":", reqObj.port)}
    }
    /**
    Logs a successful upload based on the parameters in the request
    object and the UUID returned by the server.
    */
    static _logUpload(reqObj, callback = () => { }) {
        this._validateLogFile(this.uploadLogPath, uploadLogFormat, () => {
            const today = new Date(Date.now());
            fs.appendFile(this.uploadLogPath, `PUT,${reqObj.encrypted},${reqObj.fileKey},${reqObj.bucket},${today.toISOString()}\n`, callback);    
        });
    }
    /**
    Logs a successful download based on the parameters in the request
    object.
    */
    static _logDownload(reqObj, callback = () => { }) { 
        this._validateLogFile(this.downloadLogPath, downloadLogFormat, () => {
            const today = new Date(Date.now());
            fs.appendFile(this.downloadLogPath, `${reqObj.fileKey},${today.toISOString()}\n`, callback);
        });
    }
    /**
    Returns true if the provided value is a valid UUID.
    Returns false if otherwise.
    */
    static _validUUID(val) {
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
    static _validateLogFile(path, format, callback = () => { }) {
        const logDir = path.split("/").slice(0, -1).join("/");
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
            if (this.debug) {console.log("Created log dir: " + logDir);}
        }
        if (!fs.existsSync(path)) {
            fs.appendFileSync(path, format.columns.join(",") + "\n");
            console.log("Created log file: " + path);
        }
        callback();
    }
}

module.exports = NetfilesysClient;