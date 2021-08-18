const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class _Request {
    constructor(method, intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, arg) {
        this.method = method;
        this.req = req;
        this.intervalFunc = intervalFunc;
        this.intervalPeriod = intervalPeriod;
        this.maxAttempts = maxAttempts;
        this.interval = setInterval(() => {
            if (!this.intervalLock) {
                this.intervalFunc();
                this.attempts++;
                if (this.attempts >= this.maxAttempts) {
                    clearInterval(this.interval);
                    this.failed = true;
                    console.log(`FAILED: ${this.arg}`)
                }
            }
        }, intervalPeriod);
        this.intervalLock = false;
        this.attempts = 0;
        this.hostname = hostname;
        this.port = port;
        this.arg = arg; //filekey for get requests
        this.failed = false;
    }
}
class GetRequest extends _Request {
    constructor(intervalFunc, intervalPeriod, maxAttempts, req = null, hostname = '', port = null, downloadFileName = undefined, fileKey) {
        super('GET', intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, fileKey);
        this.checkFilekey(fileKey);
        this.encrypted = fileKey.length > 32 ? true : false;
        this.fileKey = fileKey;
        this.uuid = fileKey.substr(0, 32);
        this.key = '';
        this.iv = '';
        if (this.encrypted) {
            this.key = fileKey.substr(32, 32);
            this.iv = fileKey.slice(64);
        }
        this.downloadFileName = downloadFileName ? downloadFileName : this.uuid + this.key + this.iv;
    }
    checkFilekey(fileKey) {
        if (fileKey.length !== 32 && fileKey.length !== 80) { //must either be 32 or 80 characters
            clearInterval(this.interval); //originally set in super() call
            throw new Error('Invalid file key: incorrect length');
        }
        for(let i = 0; i < fileKey.length; i++) { //must have all hex digits
            const char =  fileKey.charAt(i);
            if (!((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f'))) {
                clearInterval(this.interval); //originally set in super() call
                throw new Error(`Invalid file key (${fileKey}): must be fully hexadecimal`);
            }
        }
    }
}
class _UploadRequest extends _Request {
    constructor(method, intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, bucket, encrypted, filePath, uuid, fileSize) {
        super(method, intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, filePath);
        this.checkFilePath(filePath);
        this.bucket = bucket;
        this.encrypted = encrypted;
        this.filePath = filePath;
        this.fileName = filePath.split('/').slice(-1)[0];
        this.uuid = uuid;
        this.fileSize = fileSize; //additional 8 bytes to account for possible aes encryption padding
        this.key = '';
        this.iv = '';
        if (this.encrypted) {
            this.key = uuidv4().replace(/-/g, '');
            this.iv = crypto.randomBytes(8).toString('hex');
        }
        this.readStream = this.genReadStream(this.encrypted, this.filePath, this.key, this.iv);        
    }
    checkFilePath(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File path (${filePath}) does not exist`);
        }
    }
    genReadStream(encrypted, filePath, key, iv) {
        try {
            if (encrypted) {
                const readStream = fs.createReadStream(filePath);
                const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
                readStream.on('error', err => {
                    console.error(err);
                    readStream.close();
                    cipher.close();
                });
                cipher.on('error', err => {
                    console.error(err);
                    readStream.close();
                    cipher.close();
                });
                const encryptedStream = readStream.pipe(cipher);
                encryptedStream.on('error', err => {
                    console.error(err);
                    encryptedStream.close();
                });
                return encryptedStream;
            } else {
                const readStream = fs.createReadStream(filePath);
                readStream.on('error', err => {
                    console.error(err);
                    readStream.close();
                });
                return readStream;
            }
        } catch {
            throw new Error(`Cannot generate ${encrypted ? 'encrypted ' : ''}readStream from file path ${filePath}`);
        }
    }
}
class PutRequest extends _UploadRequest {
    constructor(intervalFunc = () => {}, intervalPeriod = 1000, maxAttempts = 0, req = null, hostname = '', port = null, bucket = 'default', encrypted = true, filePath = '', uuid = '', fileSize = null) {
        super('PUT', intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, bucket, encrypted, filePath, uuid, fileSize);
    }
}
class PostRequest extends _UploadRequest {
    constructor(intervalFunc = () => {}, intervalPeriod = 1000, maxAttempts = 0, req = null, hostname = '', port = null, bucket = 'default', encrypted = true, filePath = '', uuid = '', fileSize = null) {
        super('POST', intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, bucket, encrypted, filePath, uuid, fileSize);
    }
}


module.exports.GetRequest = GetRequest;
module.exports.PutRequest = PutRequest;
module.exports.PostRequest = PostRequest;