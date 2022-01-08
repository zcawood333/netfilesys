const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class _Request {
  constructor (method, intervalFunc, intervalPeriod, maxAttempts, arg) {
    this.method = method;
    this.intervalFunc = intervalFunc;
    this.intervalPeriod = intervalPeriod;
    this.maxAttempts = maxAttempts;
    this.arg = arg; // fileKey for GetRequest and filePath for PutRequest
    this.resolve = null;
    this.reject = null;
    this.promise = new Promise((resolve, reject) => {this.resolve = resolve; this.reject = reject;});
    this.interval = setInterval(() => {
      if (!this.intervalLock) {
        if (this.attempts >= this.maxAttempts) {
          this.failed = true;
          this.end();
          console.log(`FAILED: ${this.arg}`);
        } else {
          this.intervalFunc();
          this.attempts++;
        }
      }
    }, intervalPeriod);
    this.intervalLock = false;
    this.attempts = 0;
    this.req = undefined;
    this.hostname = undefined;
    this.port = undefined;
    this.failed = false;
  }

  end () {
    try {
      clearInterval(this.interval);
    } catch (err) {}
    if (this.failed) {
      this.reject(new Error(`Failed to fulfill ${this.method} request`));
    } else {
      this.resolve();
    }
  }
}
class GetRequest extends _Request {
  constructor (fileKey, intervalFunc, intervalPeriod, maxAttempts, downloadFileDir, downloadFileName = undefined) {
    super('GET', intervalFunc, intervalPeriod, maxAttempts, fileKey);
    this._checkFileKey(fileKey);
    this.encrypted = fileKey.length > 32;
    this.fileKey = fileKey;
    this.uuid = fileKey.substr(0, 32);
    this.key = '';
    this.iv = '';
    if (this.encrypted) {
      this.key = fileKey.substr(32, 32);
      this.iv = fileKey.slice(64);
    }
    this.downloadFileDir = downloadFileDir;
    this.downloadFileName = downloadFileName || fileKey;
    this.downloadFilePath = this._genDownloadPath(this.downloadFileDir, this.downloadFileName);
    this.writeStream = this._genWriteStream(this.encrypted, this.downloadFilePath, this.key, this.iv);
  }

  _checkFileKey (fileKey) {
    if (fileKey.length !== 32 && fileKey.length !== 80) { // must either be 32 or 80 characters
      this.end();
      throw new Error('Invalid file key: incorrect length');
    }
    for (let i = 0; i < fileKey.length; i++) { // must have all hex digits
      const char = fileKey.charAt(i);
      if (!((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f'))) {
        this.end();
        throw new Error(`Invalid file key (${fileKey}): must be fully hexadecimal`);
      }
    }
  }

  _genDownloadPath (downloadFileDir, downloadFileName) {
    if (downloadFileDir === undefined) { throw new Error(`Invalid downloadFileDir: ${downloadFileDir}`); }
    if (!fs.existsSync(downloadFileDir)) {
      fs.mkdirSync(downloadFileDir, { recursive: true });
    }
    return downloadFileDir + '/' + downloadFileName;
  }

  _genWriteStream (encrypted, downloadFilePath, key, iv) {
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

  end () {
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
class PutRequest extends _Request {
  constructor (filePath, intervalFunc, intervalPeriod, maxAttempts, bucket, encrypted, uuid) {
    super('PUT', intervalFunc, intervalPeriod, maxAttempts, filePath);
    this._checkFilePath(filePath);
    this.bucket = bucket;
    this.encrypted = encrypted;
    this.filePath = filePath;
    this.fileName = filePath.split('/').slice(-1)[0];
    this.uuid = uuid;
    this.fileSize = fs.statSync(filePath).size + 8; // additional 8 bytes to account for possible aes encryption padding
    this.key = '';
    this.iv = '';
    if (this.encrypted) {
      this.key = uuidv4().replace(/-/g, '');
      this.iv = crypto.randomBytes(8).toString('hex');
    }
    this.readStream = this._genReadStream(this.encrypted, this.filePath, this.key, this.iv);
    this.fileKey = undefined; // defined after uploading
  }

  _checkFilePath (filePath) {
    if (!fs.existsSync(filePath)) {
      this.end();
      throw new Error(`File path (${filePath}) does not exist`);
    }
  }

  _genReadStream (encrypted, filePath, key, iv) {
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
      this.end();
      throw new Error(`Cannot generate ${encrypted ? 'encrypted ' : ''}readStream from file path ${filePath}`);
    }
  }

  end () {
    super.end();
    try {
      this.readStream.close();
    } catch {}
  }
}

module.exports.GetRequest = GetRequest;
module.exports.PutRequest = PutRequest;
