//server.js

const express = require('express');
const app = express();
const dgram = require('dgram');
const multicastServer = dgram.createSocket('udp4');
const multicastAddr = '230.185.192.108';
const multicastServerPort = 5002;
const multicastClientPort = 5001;
const { v4: uuidv4 } = require('uuid');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const tcpAddr = '0.0.0.0';
const tcpPort = 5000;
const uploadsDir = `${__dirname}/uploads/`;
const uploadLogPath = `${__dirname}/logs/upload_log.csv`;
const downloadLogPath = `${__dirname}/logs/download_log.csv`;

//testing variables
const debug = true;

//MAIN CODE
app.use(fileUpload());

app.get('/exist', (req, res) => {
    res.send('Hello world\n');
});

app.get('/download/:uuid', (req, res) => {
    if (debug) {console.log('GET request: ', req.params)};
    let parsedUUIDPath = req.params.uuid;
    parsedUUIDPath = parsedUUIDPath.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    let path = `${uploadsDir}${parsedUUIDPath}`;
    
    if (debug) {console.log(`path: ${path}`)};

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
                            let newData = data.toString().split('\n').slice(0,-2).join('\n') + '\n';
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
if (debug) console.log(`Starting multicastServer on port ${multicastServerPort}`);
initMulticastServer();
console.log(`current directory: ${__dirname}`);

//FUNCTIONS
function initMulticastServer() {
    multicastServer.on('listening', function () {
        if (debug) {
            console.log(`multicastServer listening on multicast address ${multicastAddr}`)
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
    multicastServer.bind(multicastServerPort);
}
function sendMulticastMsg(msg = 'this is a sample multicast message (from server)', close = false, targetPort = multicastClientPort, targetAddr = multicastAddr) {
    const message = new Buffer.from(msg);
    multicastServer.send(message, 0, message.length, targetPort, targetAddr, () => {
        if (close) {
            multicastServer.close();
            if (debug) {console.log('multicastServer closed')}
        }
    });
    if (debug) {console.log("Sent " + message)}
}
function multicastGet(message, remote) {
    let uuid = message.toString().slice(1);
    if (debug) {console.log(`parsed uuid: ${uuid}`)}
    let path = uploadsDir + uuid.replace(/-/g,'').replace(/(.{3})/g, "$1/");
    if (fs.existsSync(path)) {
        sendMulticastMsg('h' + uuid, false, undefined, remote.address);
    }
}
function uploadMultipartFile(req, res) {
    if (debug) {
        console.log('POST request headers: ', req.headers);
        console.log('POST request body: ', req.body);
        console.log('Files: ', req.files);
    }
    let fp;
    let path;
    let uuid;

    //pulled from example: https://github.com/richardgirges/express-fileupload/tree/master/example
    if (!req.files || Object.keys(req.files).length === 0) {
        if (debug) {console.log('No files to upload')};
        return res.status(400).send('No files were uploaded.');
    }

    fp = req.files.fileKey;
    const ogUUID = uuidv4();
    if (debug) {console.log(`uuid: ${ogUUID}`)};
    const noDashesUUID = ogUUID.replace(/-/g,'');
    if (debug) {console.log(`uuid without dashes: ${noDashesUUID}`)};
    uuid = noDashesUUID.replace(/(.{3})/g,"$1/")
    if (debug) {console.log(`uuid turned into path: ${uuid}`)};
    path = `${uploadsDir}${uuid}`;
    if (!fs.existsSync(path.slice(0,-2))) {fs.mkdirSync(path.slice(0,-2), {recursive: true})};

    fp.mv(path, err => {
        if (err) {
            if (debug) {console.log('file unable to be uploaded (1)', err)};
            return res.status(500).send(err);
        } else {
            if (debug) {console.log(`File ${fp.name} uploaded to ${path}`)};
            const today = new Date(Date.now());
            fs.appendFile(uploadLogPath, `POST,${fp.name},${ogUUID},${today.toISOString()}\n`, err => {
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
    const ogUUID = uuidv4();
    if (debug) {console.log(`uuid: ${ogUUID}`)};
    const noDashesUUID = ogUUID.replace(/-/g,'');
    if (debug) {console.log(`uuid without dashes: ${noDashesUUID}`)};
    uuid = noDashesUUID.replace(/(.{3})/g,"$1/")
    if (debug) {console.log(`uuid turned into path: ${uuid}`)};
    const path = `${uploadsDir}${uuid}`;
    if (!fs.existsSync(path.slice(0,-2))) {fs.mkdirSync(path.slice(0,-2), {recursive: true})};
    //write req contents to the filepath
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
        const today = new Date(Date.now());
        fs.appendFile(uploadLogPath, `PUT,,${ogUUID},${today.toISOString()}\n`, err => {
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