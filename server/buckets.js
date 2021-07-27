const fs = require('fs');
const uploadsDir = `${__dirname}/uploads/`;

class Bucket{
    constructor(name, mountPoint, type) {
        this.name = name;
        this.mountPoint = mountPoint;
        this.type = type;
    }
    fileExists(filePath) {
        return fs.existsSync(`${uploadsDir}${this.mountPoint}${filePath}`);
    }
}
class DefaultBucket extends Bucket {
    constructor(name) {
        super(name, '', 'default');
    }
}
class StandardBucket extends Bucket {
    constructor(name, mountPoint) {
        super(name, mountPoint, 'std');
    }
}
class TempBucket extends Bucket {
    constructor(name, mountPoint, timeMin) {
        super(name, mountPoint, 'tmp');
        this.timeMin = timeMin; //time after which files are deleted
        this.maxError = 0.1; //max percent of extra time files might live before deletion (e.g. files may live 0.1 ==> 10% longer than timeMin)
        this.cleanerFunc = () => {
            rmDirTimed(`${uploadsDir}${this.mountPoint}`, false, this.timeMin, this.cleanerIgnore);
        }
        this.cleanerPeriod = (timeMin * 1000 * 60) * this.maxError;
        this.cleaner = setInterval(cleanerFunc, cleanerPeriod);
    }
}


function initBuckets() {
    const numTempBuckets = 3; //number of temp buckets
    const tempBucketMultiplier = 2; //multiplier between temp buckets' cleaning intervals
    const tempBucketInit = 1; //fastest cleaning temp bucket's interval (min)
    const buckets = {};
    buckets['default'] = new DefaultBucket('default');
    buckets['std'] = new StandardBucket('std', 'std/');
    for(let i = tempBucketInit; i < tempBucketInit * Math.pow(tempBucketMultiplier, numTempBuckets); i *= tempBucketMultiplier) {
        buckets[`tmp${i}`] = new TempBucket(`tmp${i}`, `tmp${i}/`, i);  
    }
    return buckets;
}
function rmDirTimed(dirPath, removeSelf, timeMin, filesToIgnore) { //from https://gist.github.com/liangzan/807712/8fb16263cb39e8472d17aea760b6b1492c465af2
    try { files = fs.readdirSync(dirPath); }
    catch(err) { return; }
    if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
            var filePath = dirPath + '/' + files[i];
            if (fs.statSync(filePath).isFile()) {
                if (isOlderThan(filePath, timeMin)) {
                    fs.unlinkSync(filePath);
                }
            }
            else {
                rmDirTimed(filePath, true, timeMin);
            }
        }
    }
    if (removeSelf) {
        try { fs.rmdirSync(dirPath); } //only removes directories if they are empty
        catch(err) { return; }
    }
}
function isOlderThan(filePath, timeMin) {
    const stat = fs.statSync(filePath);
    const now = new Date().getTime();
    const endTime = new Date(stat.ctime).getTime() + timeMin * 60 * 1000;
    if (endTime < now) {
        return true;
    } else {
        return false;
    }
}

  module.exports = {initBuckets};