//server.js

const express = require('express');
const app = express();
const dgram = require('dgram');
const multicastServer = dgram.createSocket({type: 'udp4', reuseAddr: true});
const multicastAddr = '230.185.192.108';
const multicastPort = 5001;
const { v4: uuidv4 } = require('uuid');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const tcpAddr = '0.0.0.0';
const tcpPort = 5000;
const uploadsDir = `${__dirname}/uploads/`;
const uploadLogPath = `${__dirname}/logs/upload_log.csv`;
const uploadLogFormat = {columns: ['method','filename','uuid','datetime']}
const downloadLogPath = `${__dirname}/logs/download_log.csv`;
const downloadLogFormat = {columns: ['uuid','datetime']}

//testing variables
const debug = true;

//MAIN CODE
app.use(fileUpload());

app.get('/exist', (req, res) => {
    res.send('Hello world\n');
});

app.get('/download/:uuid', (req, res) => {
    if (debug) {console.log('GET request: ', req.params)};
    const parsedUUIDPath = req.params.uuid.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    const path = `${uploadsDir}${parsedUUIDPath}`;
    
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

//start both tcp and udp server
if (debug) console.log(`Starting http based server on ${tcpAddr}:${tcpPort}`);
app.listen(tcpPort, tcpAddr);
if (debug) console.log(`Starting multicastServer on port ${multicastPort}`);
initMulticastServer();
console.log(`current directory: ${__dirname}`);

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
            default:
                break;
        }
    });
    multicastServer.bind(multicastPort, '192.168.1.43');
    
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
    const path = uploadsDir + uuid.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    if (fs.existsSync(path)) {
        sendMulticastMsg('h' + uuid, false, multicastPort, multicastAddr);
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
    const path = createPath(noDashesUUID);
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
    const path = createPath(noDashesUUID);
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
function createPath(noDashesUUID) {
    const uuidPath = noDashesUUID.replace(/(.{3})/g,"$1/")
    if (debug) {console.log(`uuid turned into path: ${uuidPath}`)};
    return `${uploadsDir}${uuidPath}`;
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