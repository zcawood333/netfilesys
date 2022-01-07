#!/usr/bin/node
// import http from 'http';
"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));

var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

var _defineProperty2 = _interopRequireDefault(require("@babel/runtime/helpers/defineProperty"));

var http = require('http');

var _require = require('uuid'),
    uuidv4 = _require.v4;

var fs = require('fs');

var dgram = require('dgram');

var ipAddr = require('ip').address();

var _require2 = require('./requests'),
    GetRequest = _require2.GetRequest,
    PutRequest = _require2.PutRequest;

var multicastClient = dgram.createSocket({
  type: 'udp4',
  reuseAddr: true
});
var uploadLogFormat = {
  columns: ['method', 'encrypted', 'fileKey', 'bucket', 'datetime']
}; //used to create log file if missing

var downloadLogFormat = {
  columns: ['uuid', 'datetime']
}; //used to create log file if missing

var NetfilesysClient = /*#__PURE__*/function () {
  function NetfilesysClient() {
    (0, _classCallCheck2["default"])(this, NetfilesysClient);
  }

  (0, _createClass2["default"])(NetfilesysClient, null, [{
    key: "init",
    value: // number of attempts to complete a command (send multicast message)
    // milliseconds attempts will wait before trying again
    //where files downloaded with GET are stored
    //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime
    //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime
    //FUNCTIONS

    /**
    Initializes the multicast socket for the client and subscribes
    to the address saved in 'multicastAddr'. Also initializes any
    class variables specified in parameters.
    */
    function () {
      var _init = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee() {
        var _this = this;

        var multicastAddr,
            multicastPort,
            numAttempts,
            attemptTimeout,
            downloadDir,
            uploadLogPath,
            downloadLogPath,
            debug,
            _args = arguments;
        return _regenerator["default"].wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                multicastAddr = _args.length > 0 && _args[0] !== undefined ? _args[0] : '230.185.192.108';
                multicastPort = _args.length > 1 && _args[1] !== undefined ? _args[1] : 5001;
                numAttempts = _args.length > 2 && _args[2] !== undefined ? _args[2] : 8;
                attemptTimeout = _args.length > 3 && _args[3] !== undefined ? _args[3] : 200;
                downloadDir = _args.length > 4 && _args[4] !== undefined ? _args[4] : "".concat(__dirname, "/../downloads");
                uploadLogPath = _args.length > 5 && _args[5] !== undefined ? _args[5] : "".concat(__dirname, "/../logs/upload_log.csv");
                downloadLogPath = _args.length > 6 && _args[6] !== undefined ? _args[6] : "".concat(__dirname, "/../logs/download_log.csv");
                debug = _args.length > 7 && _args[7] !== undefined ? _args[7] : false;
                this.multicastAddr = multicastAddr;
                this.multicastPort = multicastPort;
                this.numAttempts = numAttempts; // number of attempts to complete a command (send multicast message)

                this.attemptTimeout = attemptTimeout; // milliseconds attempts will wait before trying again

                this.downloadDir = downloadDir; //where files downloaded with GET are stored

                this.uploadLogPath = uploadLogPath; //stores method, encryption (bool), fileKeys (serverUUID + clientKey + clientIV), and the datetime

                this.downloadLogPath = downloadLogPath; //stores fileKeys (serverUUID + clientKey + clientIV) and the datetime

                this.debug = debug;

                if (this.debug) {
                  console.log('DEBUG OUTPUT ON');
                }

                multicastClient.on('error', function (err) {
                  console.error(err);
                });
                multicastClient.on('listening', function (err) {
                  if (err) {
                    console.error(err);
                    return;
                  }

                  if (_this.debug) {
                    console.log('Starting multicast client:', multicastClient.address(), 'listening on', _this.multicastAddr);
                  }

                  multicastClient.setBroadcast(true);
                  multicastClient.setMulticastTTL(128);
                  multicastClient.addMembership(_this.multicastAddr);
                  Object.keys(_this.requests).forEach(function (key) {
                    _this.requests[key].intervalLock = false;
                  }); // if any requests were initialized before init(), they were locked, so unlock them

                  _this.initialized = true;
                });
                multicastClient.on('message', function (message, remote) {
                  if (_this.debug) {
                    console.log('From: ' + remote.address + ':' + remote.port + ' - ' + message);
                  }

                  message = message.toString();
                  var uuidAndPort = message.slice(1).split(':');
                  var uuid = uuidAndPort[0];

                  switch (message.charAt(0)) {
                    case 'h':
                      //validate uuid
                      if (_this._validUUID(uuid) && _this.requests[uuid] && !_this.requests[uuid].intervalLock) {
                        var reqObj = _this.requests[uuid]; //record information

                        reqObj.hostname = remote.address;
                        reqObj.port = uuidAndPort[1]; //temporarily disable multicast messaging

                        reqObj.intervalLock = true; //get file from server claiming to have it

                        _this._httpGet(reqObj, function (success) {
                          if (!success) {
                            //keep trying the request
                            reqObj.intervalLock = false;
                          }
                        });
                      }

                      break;

                    case 's':
                      if (_this._validUUID(uuid) && _this.requests[uuid] && !_this.requests[uuid].intervalLock) {
                        var _reqObj = _this.requests[uuid]; //record information

                        _reqObj.hostname = remote.address;
                        _reqObj.port = uuidAndPort[1]; //temporarily disable multicast messaging

                        _reqObj.intervalLock = true; //upload file to server claiming to have space

                        _this._httpPut(_reqObj, function (success) {
                          if (!success) {
                            //keep trying the request
                            _reqObj.intervalLock = false;
                          }
                        });
                      }

                      break;

                    default:
                      break;
                  }
                });
                multicastClient.bind(this.multicastPort, ipAddr);

              case 21:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this);
      }));

      function init() {
        return _init.apply(this, arguments);
      }

      return init;
    }()
    /**
    Main PUT function that creates a PutRequest object. 
    */

  }, {
    key: "put",
    value: function () {
      var _put = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee2(arg) {
        var _this2 = this;

        var bucket,
            encryption,
            callback,
            fileSize,
            uuid,
            reqObj,
            _args2 = arguments;
        return _regenerator["default"].wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                bucket = _args2.length > 1 && _args2[1] !== undefined ? _args2[1] : 'std';
                encryption = _args2.length > 2 && _args2[2] !== undefined ? _args2[2] : true;
                callback = _args2.length > 3 && _args2[3] !== undefined ? _args2[3] : function (filekey, error) {};
                fileSize = fs.statSync(arg).size + 8;
                uuid = uuidv4().replace(/-/g, '');
                _context2.prev = 5;
                reqObj = new PutRequest(arg, function () {
                  _this2._sendMulticastMsg('u' + uuid + ':' + fileSize);
                }, this.attemptTimeout, this.numAttempts, bucket, encryption, uuid);

                if (!this.initialized) {
                  reqObj.intervalLock = true;
                }

                if (this.debug) {
                  console.log(reqObj);
                }

                this.requests[reqObj.uuid] = reqObj;
                _context2.next = 12;
                return reqObj.promise;

              case 12:
                callback(reqObj.filekey, null);
                _context2.next = 18;
                break;

              case 15:
                _context2.prev = 15;
                _context2.t0 = _context2["catch"](5);
                // throw new Error('NetFileSys put request failed', err);
                callback(null, _context2.t0);

              case 18:
                _context2.prev = 18;

                if (this.requests[uuid]) {
                  delete this.requests[uuid];
                }

                return _context2.finish(18);

              case 21:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this, [[5, 15, 18, 21]]);
      }));

      function put(_x) {
        return _put.apply(this, arguments);
      }

      return put;
    }()
    /**
    Main GET function that creates a GetRequest object.
    */

  }, {
    key: "get",
    value: function () {
      var _get = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee3(arg, outputFile) {
        var _this3 = this;

        var callback,
            uuid,
            reqObj,
            _args3 = arguments;
        return _regenerator["default"].wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                callback = _args3.length > 2 && _args3[2] !== undefined ? _args3[2] : function (error) {};
                uuid = null;
                _context3.prev = 2;
                reqObj = new GetRequest(arg, function () {
                  _this3._sendMulticastMsg('g' + arg.substr(0, 32));
                }, this.attemptTimeout, this.numAttempts, this.downloadDir, outputFile);
                uuid = reqObj.uuid;

                if (!this.initialized) {
                  reqObj.intervalLock = true;
                }

                if (this.debug) {
                  console.log(reqObj);
                }

                this.requests[reqObj.uuid] = reqObj;
                _context3.next = 10;
                return reqObj.promise;

              case 10:
                callback(null);
                _context3.next = 16;
                break;

              case 13:
                _context3.prev = 13;
                _context3.t0 = _context3["catch"](2);
                // throw new Error('NetFileSys get request failed', err);
                callback(_context3.t0);

              case 16:
                _context3.prev = 16;

                if (this.requests[uuid]) {
                  delete this.requests[uuid];
                }

                return _context3.finish(16);

              case 19:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3, this, [[2, 13, 16, 19]]);
      }));

      function get(_x2, _x3) {
        return _get.apply(this, arguments);
      }

      return get;
    }()
    /**
    Closes the multicast client connection.
    */

  }, {
    key: "close",
    value: function close() {
      multicastClient.close();
    }
    /**
    Initiates and completes a single http GET request based on the parameters 
    in the request object.
    */

  }, {
    key: "_httpGet",
    value: function _httpGet(reqObj) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function (success) {
        return;
      };
      var options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: '/download/' + reqObj.uuid,
        method: 'GET'
      };
      reqObj.req = http.request(options);

      this._initRequest(reqObj, callback, undefined);

      this._sendRequest(reqObj, undefined);
    }
    /**
    Initiates and completes a single http PUT request based on the parameters 
    in the request object.
    */

  }, {
    key: "_httpPut",
    value: function _httpPut(reqObj) {
      var _this4 = this;

      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function () {};
      var options = {
        hostname: reqObj.hostname,
        port: reqObj.port,
        path: '/upload',
        method: 'PUT'
      };
      reqObj.readStream.on('end', function () {
        if (_this4.debug) {
          console.log("Sent ".concat(reqObj.encrypted ? 'encrypted' : 'unencrypted', " PUT from filePath: ").concat(reqObj.filePath));
        }
      });
      reqObj.req = http.request(options);

      if (reqObj.bucket != undefined) {
        reqObj.req.setHeader('bucket', reqObj.bucket);
      }

      reqObj.req.setHeader('fileName', reqObj.fileName);

      this._initRequest(reqObj, undefined, callback);

      this._sendRequest(reqObj, reqObj.readStream);
    }
    /**
    Sends a single multicast message to multicastAddr:multicastPort
    */

  }, {
    key: "_sendMulticastMsg",
    value: function _sendMulticastMsg(msg) {
      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function () {};
      var message = new Buffer.from(msg);
      multicastClient.send(message, 0, message.length, this.multicastPort, this.multicastAddr, callback);

      if (this.debug) {
        console.log('Sent ' + message + ' to ' + this.multicastAddr + ':' + this.multicastPort);
      }
    }
    /**
    Initializes a single http request and determines the program's
    actions upon receiving a response. For GET requests, it 
    downloads the file sent and logs it. For PUT requests, it 
    logs a successful upload.
    */

  }, {
    key: "_initRequest",
    value: function _initRequest(reqObj) {
      var _this5 = this;

      var getCallback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function (success) {
        return;
      };
      var putCallback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function (success) {
        return;
      };
      reqObj.req.on('error', function (err) {
        console.error(err);
      });
      reqObj.req.on('response', function (res) {
        if (_this5.debug) {
          console.log("Status code: ".concat(res.statusCode));
        }

        if (res.statusCode === 200) {
          res.on('data', function (d) {
            if (_this5.debug) {
              console.log('Data: ', d.toString());
            }

            if (reqObj.method === 'GET') {
              _this5._logDownload(reqObj, function () {
                if (_this5.debug) {
                  console.log('File download logged successfully');
                }
              });
            } else if (reqObj.method === 'PUT') {
              reqObj.fileKey = "".concat(d).concat(reqObj.key).concat(reqObj.iv);

              _this5._logUpload(reqObj, function () {
                if (_this5.debug) {
                  console.log('File upload logged successfully');
                }
              });
            } else {
              throw new Error('Unknown request type: ' + reqObj.method);
            }
          });

          if (reqObj.method === 'GET') {
            reqObj.writeStream.on('finish', function () {
              if (_this5.debug) {
                console.log("File downloaded to ".concat(reqObj.downloadFilePath));
              }

              reqObj.end();
            });
            res.pipe(reqObj.writeStream);
          } else {
            //successfully uploaded a file
            reqObj.end();
          }

          getCallback(true);
          putCallback(true);
        } else {
          getCallback(false);
          putCallback(false);
        }
      });
    }
    /**
    Sends an initialized http request based on its type.
    GET requests can just be end()ed, whereas PUT
    requests have their upload file's contents piped to
    the request object.
    */

  }, {
    key: "_sendRequest",
    value: function _sendRequest(reqObj) {
      var readStream = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

      switch (reqObj.method) {
        case 'GET':
          reqObj.req.end();
          break;

        case 'PUT':
          readStream.pipe(reqObj.req);
          break;

        default:
          throw new Error('Unknown request type: ' + reqObj.method);
          break;
      }

      if (this.debug) {
        console.log('Sent ', reqObj.req.method, ' request to ', reqObj.req.host, ':', reqObj.port);
      }
    }
    /**
    Logs a successful upload based on the parameters in the request
    object and the UUID returned by the server.
    */

  }, {
    key: "_logUpload",
    value: function _logUpload(reqObj) {
      var _this6 = this;

      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function () {};

      this._validateLogFile(this.uploadLogPath, uploadLogFormat, function () {
        var today = new Date(Date.now());
        fs.appendFile(_this6.uploadLogPath, "PUT,".concat(reqObj.encrypted, ",").concat(reqObj.fileKey, ",").concat(reqObj.bucket, ",").concat(today.toISOString(), "\n"), callback);
      });
    }
    /**
    Logs a successful download based on the parameters in the request
    object.
    */

  }, {
    key: "_logDownload",
    value: function _logDownload(reqObj) {
      var _this7 = this;

      var callback = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function () {};

      this._validateLogFile(this.downloadLogPath, downloadLogFormat, function () {
        var today = new Date(Date.now());
        fs.appendFile(_this7.downloadLogPath, "".concat(reqObj.fileKey, ",").concat(today.toISOString(), "\n"), callback);
      });
    }
    /**
    Returns true if the provided value is a valid UUID.
    Returns false if otherwise.
    */

  }, {
    key: "_validUUID",
    value: function _validUUID(val) {
      var newVal = val.replace(/-/g, '');

      if (newVal.length !== 32) {
        return false;
      }

      for (var i = 0; i < newVal.length; i++) {
        var _char = newVal.charAt(i);

        if (_char >= '0' && _char <= '9' || _char >= 'a' && _char <= 'f') {
          continue;
        }

        return false;
      }

      return true;
    }
    /**
    Ensures that the provided path to the log file exists,
    creating the file based on the format argument if
    necessary.
    */

  }, {
    key: "_validateLogFile",
    value: function _validateLogFile(path, format) {
      var callback = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function () {};
      var logDir = path.split('/').slice(0, -1).join('/');

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, {
          recursive: true
        });

        if (this.debug) {
          console.log('Created log dir: ' + logDir);
        }
      }

      if (!fs.existsSync(path)) {
        fs.appendFileSync(path, format.columns.join(',') + '\n');
        console.log('Created log file: ' + path);
      }

      callback();
    }
  }]);
  return NetfilesysClient;
}();

(0, _defineProperty2["default"])(NetfilesysClient, "initialized", false);
(0, _defineProperty2["default"])(NetfilesysClient, "multicastAddr", null);
(0, _defineProperty2["default"])(NetfilesysClient, "multicastPort", null);
(0, _defineProperty2["default"])(NetfilesysClient, "numAttempts", null);
(0, _defineProperty2["default"])(NetfilesysClient, "attemptTimeout", null);
(0, _defineProperty2["default"])(NetfilesysClient, "downloadDir", null);
(0, _defineProperty2["default"])(NetfilesysClient, "uploadLogPath", null);
(0, _defineProperty2["default"])(NetfilesysClient, "downloadLogPath", null);
(0, _defineProperty2["default"])(NetfilesysClient, "debug", null);
(0, _defineProperty2["default"])(NetfilesysClient, "requests", {});
module.exports = NetfilesysClient;