//server.js

const argv = processArgv(process.argv.slice(2));
const express = require('express');
const app = express();
const fileUpload = require('express-fileupload');
const diskusage = require('diskusage');
const mountPoint = '/';
const errorHandler = require('errorhandler')
const dgram = require('dgram');
const multicastServer = dgram.createSocket({type: 'udp4', reuseAddr: true});
const multicastAddr = '230.185.192.108';
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const ipAddr = '192.168.1.43';
const backlog = 5;
const uploadsDir = `${__dirname}/uploads/`;
const uploadLogPath = `${__dirname}/logs/upload_log.csv`;
const uploadLogFormat = {columns: ['method','filename','uuid','datetime']}
const downloadLogPath = `${__dirname}/logs/download_log.csv`;
const downloadLogFormat = {columns: ['uuid','datetime']};
const buckets = require('./buckets').initBuckets();

//testing variables
const debug = true;

//Defaults
let multicastPort = 5001;
let httpPort = 0;
let httpBoundPort = undefined;

//change defaults according to argv
argsHandler();

//MAIN CODE
app.use(fileUpload());
app.use(errorHandler());

app.get('/exist', (req, res) => {
    res.send('Hello world\n');
});

app.get('/download/:uuid', (req, res) => {
    if (debug) {console.log('GET request: ', req.params)};
    const parsedUUIDPath = req.params.uuid.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    let path = undefined;
    Object.values(buckets).some(bucket => {
        if (bucket.fileExists(parsedUUIDPath)) {
            path = `${uploadsDir}${bucket.mountPoint}${parsedUUIDPath}`;
            return true;
        } else {
            return false;
        }
    });

    
    if (debug) {console.log(`path: ${path}`)};

    validateLogFile(downloadLogPath, downloadLogFormat);
    const today = new Date(Date.now());
    fs.appendFile(downloadLogPath, `${req.params.uuid},${today.toISOString()}\n`, err => {
        if (err) {
            if (debug) {console.log('file download unable to be logged, and therefore will not be downloaded', err)};
            return res.status(500).send(err);
        } else {
            res.download(path, err => {
                if (err) {
                    if (debug) {console.log('file unable to be downloaded', err)};

                    //remove last line from log file
                    fs.readFile(downloadLogPath, (err, data) => {
                        if (err) {
                            if (debug) {console.log('download log file unable to be modified; most recent log is invalid')};
                        } else {
                            console.log(data);
                            //need to slice to -2 because there is a new line character after last entry
                            const newData = data.toString().split('\n').slice(0,-2).join('\n') + '\n';
                            fs.writeFile(downloadLogPath, newData, err => {
                                if (err) {
                                    if (debug) {console.log('download log file unable to be written to; it may now be corrupted')};
                                } else {
                                    if (debug) {console.log('download log file updated to remove bad download line')};
                                }
                            });
                        }
                    });

                    //normally returns full path which may be undesirable to leak so path is reset
                    err.path = req.params.uuid;
                    return res.status(500).send(err);
                } else {
                    if (debug) {
                        console.log('file downloaded successfully');
                        console.log('file download logged successfully');
                    }
                }
            })
        }
    });
});

app.put('/upload', (req, res) => {
    uploadDirectFile(req, res);
});

app.post('/upload', (req, res) => {
    uploadMultipartFile(req, res);
});

//start both http and udp server
if (debug) console.log(`Starting http based server on ${ipAddr}:${httpPort}`);
const listener = app.listen(httpPort, ipAddr, backlog, () => {
    if (debug) {console.log(`Starting http based server: `, listener.address())}
    httpBoundPort = listener.address().port;
});
if (debug) console.log(`Starting multicastServer on port ${multicastPort}`);
initMulticastServer();

//FUNCTIONS
function initMulticastServer() {
    multicastServer.on('error', err => {
        console.error(err);
    })
    multicastServer.on('listening', err => {
        if (err) {console.error(err); return; }
        if (debug) {
            console.log(`multicastServer listening on multicast address ${multicastAddr}`);
            console.log('multicastServer bound to address: ', multicastServer.address());
        }
        multicastServer.setBroadcast(true);
        multicastServer.setMulticastTTL(128); 
        multicastServer.addMembership(multicastAddr);
    });
    multicastServer.on('message', (message, remote) => {   
        if (debug) {console.log('From: ' + remote.address + ':' + remote.port +' - ' + message)};
        switch (message.toString().charAt(0)) {
            case 'g':
                multicastGet(message, remote);
                break;
            case 'u':
                multicastPut(message, remote);
                break;
            default:
                break;
        }
    });
    multicastServer.bind(multicastPort, ipAddr);
    
}
function sendMulticastMsg(msg = 'this is a sample multicast message (from server)', close = false, targetPort = multicastPort, targetAddr = multicastAddr) {
    const message = new Buffer.from(msg);
    multicastServer.send(message, 0, message.length, targetPort, targetAddr, () => {
        if (close) {
            multicastServer.close();
            if (debug) {console.log('multicastServer closed')}
        }
    });
    if (debug) {console.log("Sent " + message + " to " + targetAddr + ":" + targetPort)}
}
function multicastGet(message, remote) {
    const uuid = message.toString().slice(1);
    if (debug) {console.log(`parsed uuid: ${uuid}`)}
    const path = uuid.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    if (Object.values(buckets).some(bucket => {
        if (bucket.fileExists(path)) {
            if (bucket.type === 'tmp') {
                clearInterval(bucket.cleaner); //resetting timer for bucket cleaner so file isn't deleted between now and download time
                bucket.cleaner = setInterval(bucket.cleanerFunc, bucket.cleanerPeriod);
            }
            return true;
        } else {
            return false;
        }
    })) {
        sendMulticastMsg('h' + uuid + ':' + httpBoundPort, false, multicastPort, multicastAddr);
    }
}
function multicastPut(message, remote) {
    const uuidAndSize = message.toString().slice(1).split(':');
    const uuid = uuidAndSize[0];
    const size = uuidAndSize[1];
    if (debug) {console.log(`parsed uuid: ${uuid}`)}
    if (diskusage.checkSync(mountPoint).available > size) {
        sendMulticastMsg('s' + uuid + ':' + httpBoundPort, false, multicastPort, multicastAddr);
    }
}
function uploadMultipartFile(req, res) {
    if (debug) {
        console.log('POST request headers: ', req.headers);
        console.log('POST request body: ', req.body);
        console.log('Files: ', req.files);
    }
    //pulled from example: https://github.com/richardgirges/express-fileupload/tree/master/example
    if (!req.files || Object.keys(req.files).length === 0) {
        if (debug) {console.log('No files to upload')};
        return res.status(400).send('No files were uploaded.');
    }
    
    const noDashesUUID = genUUID();
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
            if (debug) {console.log('file unable to be uploaded (1)', err)};
            return res.status(500).send(err);
        } else {
            if (debug) {console.log(`File ${fp.name} uploaded to ${path}`)};
            validateLogFile(uploadLogPath, uploadLogFormat);
            const today = new Date(Date.now());
            fs.appendFile(uploadLogPath, `POST,${fp.name},${noDashesUUID},${today.toISOString()}\n`, err => {
                if (err) {
                    if (debug) {console.log('file unable to be uploaded (2)', err)};
                    fs.rm(path, err => {
                        if (err) {
                            if (debug) {console.log(`File ${fp.name} unable to be removed at ${path}`)};
                        } else {
                            if (debug) {console.log(`File ${fp.name} removed from ${path}`)};
                        }
                    });
                    return res.status(500).send(err);
                } else {
                    if (debug) {console.log('file upload logged successfully')};
                    res.send(noDashesUUID);
                };
            });
        };
    });
}
function uploadDirectFile(req, res) {
    if (debug) {
        console.log('PUT request headers: ', req.headers);
        console.log('PUT request body: ', req.body);
    }
    //generate and parse uuid/filepath
    const noDashesUUID = genUUID();
    let path;
    try {
        path = createPath(noDashesUUID, req);
    } catch(err) {
        console.error(err);
        return res.status(400).send(err);
    }
    validateDirPath(path.slice(0,-2));    //write req contents to the filepath
    const fileStream = fs.createWriteStream(path);
    fileStream.on('error', err => {
        if (err) {
            if (debug) {console.log('Writable stream error: ', err);}
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
    req.on('error', err => {
        if (err) {
            if (debug) {console.log('Request stream error: ', err);}
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
    req.on('end', () => {
        validateLogFile(uploadLogPath, uploadLogFormat);
        const today = new Date(Date.now());
        fs.appendFile(uploadLogPath, `PUT,,${noDashesUUID},${today.toISOString()}\n`, err => {
            if (err) {
                if (debug) {console.log('file unable to be uploaded (3)', err)};
                fs.rm(path, err => {
                    if (err) {
                        if (debug) {console.log(`File unable to be removed at ${path}`)};
                    } else {
                        if (debug) {console.log(`File removed from ${path}`)};
                    }
                });
                return res.status(500).send(err);
            } else {
                if (debug) {console.log('file upload logged successfully')};
                res.send(noDashesUUID);
                fileStream.close();
            }
        });
    });
    req.pipe(fileStream); 
}
function genUUID() {
    const ogUUID = uuidv4();
    if (debug) {console.log(`uuid: ${ogUUID}`)};
    const noDashesUUID = ogUUID.replace(/-/g,'');
    if (debug) {console.log(`uuid without dashes: ${noDashesUUID}`)};
    return noDashesUUID;
}
function createPath(noDashesUUID, req) {
    const bucket = req.get('bucket');
    const uuidPath = noDashesUUID.replace(/(.{3})/g,"$1/")
    if (debug) {console.log(`uuid turned into path: ${uuidPath}`)};
    let fullPath = undefined;
    if (buckets[bucket]) {
        fullPath = `${uploadsDir}${buckets[bucket].mountPoint}${uuidPath}`;
    } else {
        throw new Error(`Invalid bucket: ${bucket}`);
    }
    return fullPath;
}
function validateLogFile(path, format) {
    const logDir = path.split('/').slice(0, -1).join('/');
    validateDirPath(logDir);
    if (!fs.existsSync(path)) {
        fs.appendFileSync(path, format.columns.join(',') + '\n');
        if (debug) {console.log('created log file: ' + path);}
    }
}
function validateDirPath(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        if (debug) {console.log('created dir path: ' + dirPath);}
    }
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
function argsHandler() {
    if (argv.mport && typeof argv.mport === "string" && argv.mport.length > 0) {multicastPort = argv.mport}
    if (argv.hport && typeof argv.hport === "string" && argv.hport.length > 0) {httpPort = argv.hport}
}