"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _get2 = _interopRequireDefault(require("@babel/runtime/helpers/get"));

var _inherits2 = _interopRequireDefault(require("@babel/runtime/helpers/inherits"));

var _possibleConstructorReturn2 = _interopRequireDefault(require("@babel/runtime/helpers/possibleConstructorReturn"));

var _getPrototypeOf2 = _interopRequireDefault(require("@babel/runtime/helpers/getPrototypeOf"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

function _createSuper(Derived) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal() { var Super = (0, _getPrototypeOf2["default"])(Derived), result; if (hasNativeReflectConstruct) { var NewTarget = (0, _getPrototypeOf2["default"])(this).constructor; result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return (0, _possibleConstructorReturn2["default"])(this, result); }; }

function _isNativeReflectConstruct() { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (Reflect.construct.sham) return false; if (typeof Proxy === "function") return true; try { Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); return true; } catch (e) { return false; } }

var fs = require('fs');

var _require = require('uuid'),
    uuidv4 = _require.v4;

var crypto = require('crypto');

var _Request = /*#__PURE__*/function () {
  function _Request(method, intervalFunc, intervalPeriod, maxAttempts, arg) {
    var _this = this;

    (0, _classCallCheck2["default"])(this, _Request);
    this.method = method;
    this.intervalFunc = intervalFunc;
    this.intervalPeriod = intervalPeriod;
    this.maxAttempts = maxAttempts;
    this.arg = arg; // fileKey for GetRequest and filePath for PutRequest

    this.interval = setInterval(function () {
      if (!_this.intervalLock) {
        if (_this.attempts >= _this.maxAttempts) {
          _this.failed = true;

          _this.end();

          console.log("FAILED: ".concat(_this.arg));
        } else {
          _this.intervalFunc();

          _this.attempts++;
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

  (0, _createClass2["default"])(_Request, [{
    key: "end",
    value: function end() {
      try {
        clearInterval(this.interval);
      } catch (_unused) {}
    }
  }]);
  return _Request;
}();

var GetRequest = /*#__PURE__*/function (_Request2) {
  (0, _inherits2["default"])(GetRequest, _Request2);

  var _super = _createSuper(GetRequest);

  function GetRequest(fileKey, intervalFunc, intervalPeriod, maxAttempts, downloadFileDir) {
    var _this2;

    var downloadFileName = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : undefined;
    (0, _classCallCheck2["default"])(this, GetRequest);
    _this2 = _super.call(this, 'GET', intervalFunc, intervalPeriod, maxAttempts, fileKey);

    _this2._checkFileKey(fileKey);

    _this2.encrypted = fileKey.length > 32;
    _this2.fileKey = fileKey;
    _this2.uuid = fileKey.substr(0, 32);
    _this2.key = '';
    _this2.iv = '';

    if (_this2.encrypted) {
      _this2.key = fileKey.substr(32, 32);
      _this2.iv = fileKey.slice(64);
    }

    _this2.downloadFileDir = downloadFileDir;
    _this2.downloadFileName = downloadFileName || fileKey;
    _this2.downloadFilePath = _this2._genDownloadPath(_this2.downloadFileDir, _this2.downloadFileName);
    _this2.writeStream = _this2._genWriteStream(_this2.encrypted, _this2.downloadFilePath, _this2.key, _this2.iv);
    return _this2;
  }

  (0, _createClass2["default"])(GetRequest, [{
    key: "_checkFileKey",
    value: function _checkFileKey(fileKey) {
      if (fileKey.length !== 32 && fileKey.length !== 80) {
        // must either be 32 or 80 characters
        this.end();
        throw new Error('Invalid file key: incorrect length');
      }

      for (var i = 0; i < fileKey.length; i++) {
        // must have all hex digits
        var _char = fileKey.charAt(i);

        if (!(_char >= '0' && _char <= '9' || _char >= 'a' && _char <= 'f')) {
          this.end();
          throw new Error("Invalid file key (".concat(fileKey, "): must be fully hexadecimal"));
        }
      }
    }
  }, {
    key: "_genDownloadPath",
    value: function _genDownloadPath(downloadFileDir, downloadFileName) {
      if (downloadFileDir === undefined) {
        throw new Error("Invalid downloadFileDir: ".concat(downloadFileDir));
      }

      if (!fs.existsSync(downloadFileDir)) {
        fs.mkdirSync(downloadFileDir, {
          recursive: true
        });
      }

      return downloadFileDir + '/' + downloadFileName;
    }
  }, {
    key: "_genWriteStream",
    value: function _genWriteStream(encrypted, downloadFilePath, key, iv) {
      var _this3 = this;

      try {
        if (encrypted) {
          var decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
          decipher.on('error', function (err) {
            console.error(err);
            _this3.failed = true;
            decipher.close();
          });
          decipher.on('pipe', function () {
            var writeStream = fs.createWriteStream(downloadFilePath);
            writeStream.on('error', function (err) {
              console.error(err);
              _this3.failed = true;
              decipher.close();
              writeStream.close();
            });
            decipher.pipe(writeStream);
          });
          return decipher;
        } else {
          var writeStream = fs.createWriteStream(downloadFilePath);
          writeStream.on('error', function (err) {
            console.error(err);
            _this3.failed = true;
            writeStream.close();
          });
          return writeStream;
        }
      } catch (_unused2) {
        this.end();
        throw new Error("Cannot generate ".concat(encrypted ? 'decryption tunnel' : 'writeStream', " to ").concat(downloadFilePath));
      }
    }
  }, {
    key: "end",
    value: function end() {
      (0, _get2["default"])((0, _getPrototypeOf2["default"])(GetRequest.prototype), "end", this).call(this);

      try {
        this.writeStream.close();
      } catch (_unused3) {}

      try {
        if (this.failed) {
          fs.rm(this.downloadFilePath, function () {});
        }
      } catch (_unused4) {}
    }
  }]);
  return GetRequest;
}(_Request);

var PutRequest = /*#__PURE__*/function (_Request3) {
  (0, _inherits2["default"])(PutRequest, _Request3);

  var _super2 = _createSuper(PutRequest);

  function PutRequest(filePath, intervalFunc, intervalPeriod, maxAttempts, bucket, encrypted, uuid) {
    var _this4;

    (0, _classCallCheck2["default"])(this, PutRequest);
    _this4 = _super2.call(this, 'PUT', intervalFunc, intervalPeriod, maxAttempts, filePath);

    _this4._checkFilePath(filePath);

    _this4.bucket = bucket;
    _this4.encrypted = encrypted;
    _this4.filePath = filePath;
    _this4.fileName = filePath.split('/').slice(-1)[0];
    _this4.uuid = uuid;
    _this4.fileSize = fs.statSync(filePath).size + 8; // additional 8 bytes to account for possible aes encryption padding

    _this4.key = '';
    _this4.iv = '';

    if (_this4.encrypted) {
      _this4.key = uuidv4().replace(/-/g, '');
      _this4.iv = crypto.randomBytes(8).toString('hex');
    }

    _this4.readStream = _this4._genReadStream(_this4.encrypted, _this4.filePath, _this4.key, _this4.iv);
    _this4.fileKey = undefined; // defined after uploading

    return _this4;
  }

  (0, _createClass2["default"])(PutRequest, [{
    key: "_checkFilePath",
    value: function _checkFilePath(filePath) {
      if (!fs.existsSync(filePath)) {
        this.end();
        throw new Error("File path (".concat(filePath, ") does not exist"));
      }
    }
  }, {
    key: "_genReadStream",
    value: function _genReadStream(encrypted, filePath, key, iv) {
      try {
        if (encrypted) {
          var readStream = fs.createReadStream(filePath);
          var cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
          readStream.on('error', function (err) {
            console.error(err);
            readStream.close();
            cipher.close();
          });
          cipher.on('error', function (err) {
            console.error(err);
            readStream.close();
            cipher.close();
          });
          var encryptedStream = readStream.pipe(cipher);
          encryptedStream.on('error', function (err) {
            console.error(err);
            encryptedStream.close();
          });
          return encryptedStream;
        } else {
          var _readStream = fs.createReadStream(filePath);

          _readStream.on('error', function (err) {
            console.error(err);

            _readStream.close();
          });

          return _readStream;
        }
      } catch (_unused5) {
        this.end();
        throw new Error("Cannot generate ".concat(encrypted ? 'encrypted ' : '', "readStream from file path ").concat(filePath));
      }
    }
  }, {
    key: "end",
    value: function end() {
      (0, _get2["default"])((0, _getPrototypeOf2["default"])(PutRequest.prototype), "end", this).call(this);

      try {
        this.readStream.close();
      } catch (_unused6) {}
    }
  }]);
  return PutRequest;
}(_Request);

module.exports.GetRequest = GetRequest;
module.exports.PutRequest = PutRequest;