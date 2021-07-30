class _Request {
    constructor(type, intervalFunc, intervalPeriod, maxAttempts, req, hostname, port, id) {
        this.type = type;
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
                    console.log(`FAILED: ${this.id}`)
                }
            }
        }, intervalPeriod);
        this.intervalLock = false;
        this.attempts = 0;
        this.hostname = hostname;
        this.port = port;
        this.id = id; //filekey for get requests
        this.failed = false;
    }
}
class GetRequest extends _Request {
    constructor(intervalFunc, intervalPeriod, maxAttempts, req = null, hostname = '', port = null, fileKey) {
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
        this.downloadFileName = this.uuid + this.key + this.iv;
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
module.exports = { GetRequest };