#!/usr/bin/node

const argv = processArgv(process.argv.slice(2));
const app = require("express")();
const fileUpload = require("express-fileupload");
const errorHandler = require("errorhandler")
const dgram = require("dgram");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const ipAddr = require("ip").address();
const diskusage = require("diskusage");
const buckets = require("./buckets").initBuckets();
const multicastServer = dgram.createSocket({type: "udp4", reuseAddr: true});
const multicastAddr = "230.185.192.108";
const backlog = 5;
const uploadsDir = `${__dirname}/uploads`;
const uploadLogPath = `${__dirname}/logs/upload_log.csv`;
const uploadLogFormat = {columns: ["method","filename","uuid","bucket","datetime"]}
const downloadLogPath = `${__dirname}/logs/download_log.csv`;
const downloadLogFormat = {columns: ["uuid","datetime"]};

//testing variables
let debug = false;
if (argv.debug) {
    debug = true;
    console.log("DEBUG OUTPUT ON");
}

//Defaults
let multicastPort = 5001;
let httpPort = 0;
let httpBoundPort = undefined;

//change defaults according to argv
argsHandler();

//MAIN CODE
app.use(fileUpload());
app.use(errorHandler());

app.get("/exist", (req, res) => {
    res.send("Hello world\n");
});

app.get("/download/:uuid", (req, res) => {
    downloadFile(req, res);
});

app.put("/upload", (req, res) => {
    uploadDirectFile(req, res);
});

app.post("/upload", (req, res) => {
    uploadMultipartFile(req, res);
});

//start http and multicast server
const listener = app.listen(httpPort, ipAddr, backlog, () => {
    if (debug) {console.log("Starting http server:", listener.address())}
    httpBoundPort = listener.address().port;
});
initMulticastServer();

//FUNCTIONS
function initMulticastServer() {
    multicastServer.on("error", err => {
        console.error(err);
    })
    multicastServer.on("listening", err => {
        if (err) {console.error(err); return; }
        if (debug) {
            console.log("Starting multicast server:", multicastServer.address(), "listening on", multicastAddr);
        }
        multicastServer.setBroadcast(true);
        multicastServer.setMulticastTTL(128); 
        multicastServer.addMembership(multicastAddr);
    });
    multicastServer.on("message", (message, remote) => {   
        if (debug) {console.log("From: " + remote.address + ":" + remote.port +" - " + message)};
        switch (message.toString().charAt(0)) {
            case "g":
                multicastGet(message);
                break;
            case "u":
                multicastUpload(message);
                break;
            default:
                break;
        }
    });
    multicastServer.bind(multicastPort, ipAddr);
    
}
function sendMulticastMsg(msg = "This is a sample multicast message (from server)", close = false, targetPort = multicastPort, targetAddr = multicastAddr) {
    const message = new Buffer.from(msg);
    multicastServer.send(message, 0, message.length, targetPort, targetAddr, () => {
        if (close) {
            multicastServer.close();
            if (debug) {console.log("Multicast server closed")}
        }
    });
    if (debug) {console.log("Sent " + message + " to " + targetAddr + ":" + targetPort)}
}
function multicastGet(message) {
    const uuid = message.toString().slice(1);
    if (validUUID(uuid)) {
        const path = uuid.replace(/-/g,"").replace(/(.{3})/g, "$1/");
        if (Object.values(buckets).some(bucket => {
            if (bucket.fileExists(path)) {
                return true;
            } else {
                return false;
            }
        })) {
            sendMulticastMsg("h" + uuid + ":" + httpBoundPort, false, multicastPort, multicastAddr);
        }
    }
}
function multicastUpload(message) {
    const uuidAndSize = message.toString().slice(1).split(":");
    const uuid = uuidAndSize[0];
    if (validUUID(uuid) && uuidAndSize.length === 2) {
        const size = uuidAndSize[1];
        if (diskusage.checkSync(uploadsDir).available > size) {
            sendMulticastMsg("s" + uuid + ":" + httpBoundPort, false, multicastPort, multicastAddr);
        }
    }
}
function uploadMultipartFile(req, res) {
    if (debug) {
        console.log("POST request headers: ", req.headers);
        console.log("Files: ", req.files);
    }
    //pulled from example: https://github.com/richardgirges/express-fileupload/tree/master/example
    if (!req.files || Object.keys(req.files).length === 0) {
        if (debug) {console.log("No files to upload")};
        return res.status(400).send("No files were uploaded.");
    }
    
    const noDashesUUID = genDashlessUUID();
    let path;
    try {
        path = createPath(noDashesUUID, req);
    } catch(err) {
        console.error(err);
        return res.status(400).send(err);
    }
    validateDirPath(path.slice(0,-2));
    fp = req.files.fileKey;
    fp.mv(path, err => {
        if (err) {
            if (debug) {console.log("File unable to be uploaded (1)", err)};
            return res.status(500).send(err);
        } else {
            if (debug) {console.log(`File ${fp.name} uploaded to ${path}`)};
            validateLogFile(uploadLogPath, uploadLogFormat);
            const today = new Date(Date.now());
            fs.appendFile(uploadLogPath, `POST,${fp.name},${noDashesUUID},${req.get("bucket")},${today.toISOString()}\n`, err => {
                if (err) {
                    if (debug) {console.log("File unable to be uploaded (2)", err)};
                    fs.rm(path, err => {
                        if (err) {
                            if (debug) {console.log(`File ${fp.name} unable to be removed at ${path}`)};
                        } else {
                            if (debug) {console.log(`File ${fp.name} removed from ${path}`)};
                        }
                    });
                    return res.status(500).send(err);
                } else {
                    if (debug) {console.log("File upload logged successfully")};
                    res.send(noDashesUUID);
                    bucketHandler(req.get("bucket"));
                };
            });
        };
    });
}
function uploadDirectFile(req, res) {
    if (debug) {
        console.log("PUT request headers: ", req.headers);
    }
    //generate and parse uuid/filepath
    const noDashesUUID = genDashlessUUID();
    let path;
    try {
        path = createPath(noDashesUUID, req);
    } catch(err) {
        console.error(err);
        return res.status(400).send(err);
    }
    validateDirPath(path.slice(0,-2));    //write req contents to the filepath
    const fileStream = fs.createWriteStream(path);
    fileStream.on("error", err => {
        if (err) {
            if (debug) {console.log("Writable stream error: ", err);}
            fs.rm(path, err => {
                if (err) {
                    if (debug) {console.log(`File unable to be removed at ${path}`)};
                } else {
                    if (debug) {console.log(`File removed from ${path}`)};
                }
            });
            return res.status(500).send(err);
        }
    });
    req.on("error", err => {
        if (err) {
            if (debug) {console.log("Request stream error: ", err);}
            fs.rm(path, err => {
                if (err) {
                    if (debug) {console.log(`File unable to be removed at ${path}`)};
                } else {
                    if (debug) {console.log(`File removed from ${path}`)};
                }
            });
            return res.status(500).send(err);
        }
    });
    req.on("end", () => {
        validateLogFile(uploadLogPath, uploadLogFormat);
        const today = new Date(Date.now());
        const fileName = req.get("fileName");
        fs.appendFile(uploadLogPath, `PUT,${fileName ? fileName : ""},${noDashesUUID},${req.get("bucket")},${today.toISOString()}\n`, err => {
            if (err) {
                if (debug) {console.log("File unable to be uploaded (3)", err)};
                fs.rm(path, err => {
                    if (err) {
                        if (debug) {console.log(`File unable to be removed at ${path}`)};
                    } else {
                        if (debug) {console.log(`File removed from ${path}`)};
                    }
                });
                return res.status(500).send(err);
            } else {
                if (debug) {console.log("File upload logged successfully")};
                res.send(noDashesUUID);
                fileStream.close();
                bucketHandler(req.get("bucket"));
            }
        });
    });
    req.pipe(fileStream); 
}
function downloadFile(req, res) {
    if (debug) {console.log("GET request: ", req.params)};
    const uuid = req.params.uuid.replace(/-/g,"");
    let path = undefined;
    if (Object.keys(buckets["quick"].files).includes(uuid)) {
        quickDownload(req, res, buckets["quick"].files[uuid]);
    } else {
        Object.values(buckets).some(bucket => {
            if (bucket === "quick") {return false;}
            const parsedUUIDPath = uuid.replace(/(.{3})/g, "$1/");
            if (bucket.fileExists(parsedUUIDPath)) {
                path = `${uploadsDir}/${bucket.mountPoint}/${parsedUUIDPath}`;
                return true;
            } else {
                return false;
            }
        });
        if (path === undefined) {return res.status(500).send(new Error("File not found"));}
        
        if (debug) {console.log(`File path: ${path}`)};
    
        validateLogFile(downloadLogPath, downloadLogFormat, () => {
            const today = new Date(Date.now());
            fs.appendFile(downloadLogPath, `${req.params.uuid},${today.toISOString()}\n`, err => {
                if (err) {
                    if (debug) {console.log("File download unable to be logged", err)};
                    return res.status(500).send(err);
                } else {
                    res.download(path, err => {
                        if (err) {
                            if (debug) {console.log("File unable to be downloaded", err)};
                            //remove last line from log file
                            deleteLastDownloadLog();
                            //normally returns full path which may be undesirable to leak so path is reset
                            err.path = req.params.uuid;
                            return res.status(500).send(err);
                        } else {
                            if (debug) {
                                console.log("File downloaded/logged successfully");
                            }
                        }
                    })
                }
            });
        });
    }
}
function quickDownload(req, res, fileContents) {
    validateLogFile(downloadLogPath, downloadLogFormat, () => {
        const today = new Date(Date.now());
        fs.appendFile(downloadLogPath, `${req.params.uuid},${today.toISOString()}\n`, err => {
            if (err) {
                if (debug) {console.log("File download unable to be logged", err)};
                return res.status(500).send(err);
            } else {
                try {
                    res.status(200).send(fileContents);
                    if (debug) {
                        console.log("File downloaded/logged successfully");
                    }
                } catch(err) {
                    if (debug) {console.log("File unable to be downloaded", err)};
                    //remove last line from log file
                    deleteLastDownloadLog();
                    //normally returns full path which may be undesirable to leak so path is reset
                    err.path = req.params.uuid;
                    res.status(500).send(err);
                }
            }
        });
    });
}
function deleteLastDownloadLog() {
    fs.readFile(downloadLogPath, (err, data) => {
        if (err) {
            if (debug) {console.log("Download log file unable to be modified; most recent log is invalid")};
        } else {
            //need to slice to -2 because there is a new line character after last entry
            const newData = data.toString().split("\n").slice(0,-2).join("\n") + "\n";
            fs.writeFile(downloadLogPath, newData, err => {
                if (err) {
                    if (debug) {console.log("Download log file unable to be written to; it may now be corrupted")};
                } else {
                    if (debug) {console.log("Download log file updated to remove bad download line")};
                }
            });
        }
    });
}
function genDashlessUUID() { //returns a dashless uuid
    const ogUUID = uuidv4();
    const noDashesUUID = ogUUID.replace(/-/g,"");
    return noDashesUUID;
}
function createPath(noDashesUUID, req) {
    const bucket = req.get("bucket");
    const uuidPath = noDashesUUID.replace(/(.{3})/g,"$1/")
    let fullPath = undefined;
    if (buckets[bucket]) {
        fullPath = `${uploadsDir}/${buckets[bucket].mountPoint}/${uuidPath}`;
    } else {
        throw new Error(`Invalid bucket: ${bucket}`);
    }
    return fullPath;
}
function validateLogFile(path, format, callback = () => { }) {
    const logDir = path.split("/").slice(0, -1).join("/");
    validateDirPath(logDir, () => {
        if (!fs.existsSync(path)) {
            fs.appendFileSync(path, format.columns.join(",") + "\n");
            if (debug) {console.log("Created log file: " + path);}
        }
        callback();
    });
    
}
function validateDirPath(dirPath, callback = () => { }) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        if (debug) {console.log("Created dir path: " + dirPath);}
    }
    callback();
}
function bucketHandler(bucket) {
    switch(bucket) {
        case "quick":
            buckets[bucket].sync();
            break;
        default:
            break;
    }
}
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
function processArgv(args) {
    let argv = {_: []};
    args.forEach(arg => {
        switch (arg.charAt(0)) {
            case "-":
                switch (arg.charAt(1)) {
                    case "-":
                        const param = arg.slice(2);
                        if (param.split("=").length === 2) {
                            argv[param.split("=")[0]] = param.split("=")[1];
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
function argsHandler() {
    if (argv.mport && typeof argv.mport === "string" && argv.mport.length > 0) {multicastPort = argv.mport}
    if (argv.hport && typeof argv.hport === "string" && argv.hport.length > 0) {httpPort = argv.hport}
}