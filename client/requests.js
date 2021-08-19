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
                if (this.attempts >= this.maxAttempts) {
                    this.failed = true;
                    this.end();
                    console.log(`FAILED: ${this.arg}`)
                } else {
                    this.intervalFunc();
                    this.attempts++;
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
    end() {
        try {
            clearInterval(this.interval);
        } catch {}
    }
}
class GetRequest extends _Request {
    constructor(intervalFunc, intervalPeriod, maxAttempts, req = null, hostname = '', port = null, downloadFileDir = __dirname, downloadFileName = undefined, fileKey) {
        super('GET', intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, fileKey);
        this._checkFileKey(fileKey);
        this.encrypted = fileKey.length > 32 ? true : false;
        this.fileKey = fileKey;
        this.uuid = fileKey.substr(0, 32);
        this.key = '';
        this.iv = '';
        if (this.encrypted) {
            this.key = fileKey.substr(32, 32);
            this.iv = fileKey.slice(64);
        }
        this.downloadFileDir = downloadFileDir;
        this.downloadFileName = downloadFileName ? downloadFileName : fileKey;
        this.downloadFilePath = this._genDownloadPath(this.downloadFileDir, this.downloadFileName);
        this.writeStream = this._genWriteStream(this.encrypted, this.downloadFilePath, this.key, this.iv);
    }
    _checkFileKey(fileKey) {
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
    _genDownloadPath(downloadFileDir, downloadFileName) {
        if (downloadFileDir === undefined) {throw new Error(`Invalid downloadFileDir: ${downloadFileDir}`);}
        if (!fs.existsSync(downloadFileDir)) {
            fs.mkdirSync(downloadFileDir, { recursive: true });
        }
        return downloadFileDir + '/' + downloadFileName;

    }
    _genWriteStream(encrypted, downloadFilePath, key, iv) {
        try {
            if (encrypted) {
                const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
                decipher.on('error', err => {
                    console.error(err);
                    this.failed = true;
                    decipher.close();
                });
                decipher.on('pipe', () => {
                    const writeStream = fs.createWriteStream(downloadFilePath);
                    writeStream.on('error', err => {
                        console.error(err);
                        this.failed = true;
                        decipher.close();
                        writeStream.close();
                    });
                    decipher.pipe(writeStream);
                });
                return decipher;
            } else {
                const writeStream = fs.createWriteStream(downloadFilePath);
                writeStream.on('error', err => {
                    console.error(err);
                    this.failed = true;
                    writeStream.close();
                });
                return writeStream;
            }
        } catch {
            this.end();
            throw new Error(`Cannot generate ${encrypted ? 'decryption tunnel' : 'writeStream'} to ${downloadFilePath}`);
        }
    }
    end() {
        super.end();
        try {
            this.writeStream.close();
        } catch {}
        try {
            if (this.failed) {
                fs.rm(this.downloadFilePath, () => {});
            }
        } catch {}
    }
}
class _UploadRequest extends _Request {
    constructor(method, intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, bucket, encrypted, filePath, uuid, fileSize) {
        super(method, intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, filePath);
        this._checkFilePath(filePath);
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
        this.readStream = this._genReadStream(this.encrypted, this.filePath, this.key, this.iv);        
    }
    _checkFilePath(filePath) {
        if (!fs.existsSync(filePath)) {
            clearInterval(this.interval);
            throw new Error(`File path (${filePath}) does not exist`);
        }
    }
    _genReadStream(encrypted, filePath, key, iv) {
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
            clearInterval(this.interval);
            throw new Error(`Cannot generate ${encrypted ? 'encrypted ' : ''}readStream from file path ${filePath}`);
        }
    }
    end() {
        super.end();
        try {
            this.readStream.close();
        } catch {}
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