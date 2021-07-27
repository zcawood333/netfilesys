class Bucket{
    constructor(name, mountPoint, type) {
        this.name = name;
        this.mountPoint = mountPoint;
        this.type = type;
    }
    fileExists(filePath) {
        return fs.existsSync(`${uploadsDir}${mountPoint}${filePath}`);
    }
}
class StandardBucket extends Bucket {
    constructor(name, mountPoint) {
        super(name, mountPoint, 'std');
    }
}
// class TempBucket extends Bucket {
//     constructor(name, mountPoint, timeMin) {
//         super(name, mountPoint, 'tmp');
//         this.timeMin = timeMin;
//         this.cleaner = setInterval(() => {
//             rmDir(`${uploadsDir}${this.mountPoint}`, false);
//         }, timeMin * 1000 * 60);
//     }
// }

function initBuckets() {
    // const numTempBuckets = 3; //number of temp buckets
    // const tempBucketMultiplier = 2; //multiplier between temp buckets' cleaning intervals
    // const tempBucketInit = 1; //fastest cleaning temp bucket's interval (min)
    const buckets = {};
    buckets['std'] = new StandardBucket('std', 'std/');
    // for(let i = tempBucketInit; i < Math.pow(tempBucketMultiplier, numTempBuckets); i *= tempBucketMultiplier) {
    //     buckets.push(new TempBucket(`tmp${i}`, `/tmp${i}/`, i)));  
    // }
    return buckets;
}
function rmDir(dirPath, removeSelf) { //from https://gist.github.com/liangzan/807712/8fb16263cb39e8472d17aea760b6b1492c465af2
    try { var files = fs.readdirSync(dirPath); }
    catch(e) { return; }
    if (files.length > 0)
      for (var i = 0; i < files.length; i++) {
        var filePath = dirPath + '/' + files[i];
        if (fs.statSync(filePath).isFile())
          fs.unlinkSync(filePath);
        else
          rmDir(filePath);
      }
    if (removeSelf)
      fs.rmdirSync(dirPath);
  };

  module.exports = {initBuckets};