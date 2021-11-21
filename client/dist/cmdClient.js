#!/usr/bin/node
"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _slicedToArray2 = _interopRequireDefault(require("@babel/runtime/helpers/slicedToArray"));

var fs = require('./client');

var _require = require('process'),
    exit = _require.exit; // argv processing


var argv = processArgv(process.argv.slice(2)); // debugging

if (argv.debug) {
  console.log('DEBUG OUTPUT ON');
}

if (argv.debug) {
  console.log('argv: ', argv);
}

if (argv.help || process.argv.length <= 2 || argv._length <= 0 || argv._[0] === 'help') {
  // if help or no args
  printHelp();
  exit(0);
}

if (argv._.length > 0) {
  fs.init(undefined, argv.multicastPort, undefined, undefined, undefined, undefined, undefined, argv.debug);

  switch (argv._[0].toLowerCase()) {
    case 'get':
      argv._ = argv._.slice(1);

      argv._.forEach(function (arg) {
        fs.get(arg);
      });

      break;

    case 'put':
      argv._ = argv._.slice(1);

      argv._.forEach(function (arg) {
        fs.put(arg, argv.bucket, !argv.noEncryption);
      });

      break;

    default:
      throw new Error("Unrecognized command: ".concat(argv._[0]));
  }
}
/**
Parses the process arguments and creates an argv
variable containing argument data. Changes global
variables based on the arguments passed in.
*/


function processArgv(args) {
  var argv = {
    _: [],
    outputFiles: []
  };
  var error = null;
  args.forEach(function (arg) {
    if (error) {
      throw new Error("Invalid parameter: ".concat(error));
    }

    var _arg$split = arg.split('=');

    var _arg$split2 = (0, _slicedToArray2["default"])(_arg$split, 2);

    symbol = _arg$split2[0];
    params = _arg$split2[1];

    switch (symbol) {
      // flags
      case '--help':
        argv.help = true;
        break;

      case '-d':
      case '--debug':
        if (params == undefined) {
          argv.debug = true;
        } else {
          error = arg;
        }

        break;

      case '-n':
      case '--noEncryption':
        if (params == undefined) {
          argv.noEncryption = true;
        } else {
          error = arg;
        }

        break;
      // args

      case '-p':
      case '--port':
        if (params && !isNaN(params)) {
          argv.multicastPort = Number(params);
        } else {
          error = arg;
        }

        break;

      case '-o':
      case '--outputFiles':
        if (params) {
          argv.outputFiles = params.split(',');
        } else {
          error = arg;
        }

        break;

      case '-b':
      case '--bucket':
        if (params) {
          argv.bucket = params;
        } else {
          error = arg;
        }

        break;
      // command or command arg

      default:
        if (!symbol.startsWith('-')) {
          argv._.push(symbol);
        } else {
          error = arg;
        }

    }
  });

  if (error) {
    throw new Error('Invalid parameter: ' + error);
  }

  return argv;
}
/**
Prints the help message.
*/


function printHelp() {
  console.log('Usage: <command> <param>... [-p, --port=portNumber] [-d, --debug]\n' + '      command = GET | PUT\n' + '      param = fileKey | filepath\n' + '      port (-p): port multicast client binds and sends to\n' + '      debug (-d): displays debugging output\n' + '\n' + '      GET <fileKey>... [-o, --outputFiles=fileName1,...]\n' + // fileKey will contain uuid and aes key and iv
  '      fileKey = file identifier; found in log file after uploading with PUT\n' + '      outputFiles (-o): names to save downloaded files as (leave empty for default e.g. fileName1,,fileName3)\n' + '\n' + '      PUT <filepath>... [-b, --bucket=bucket] [-n, --noEncryption]\n' + '      filepath = path to file for uploading\n' + '      bucket (-b): bucket to upload file into\n' + '      noEncryption (-n): uploads unencrypted file contents\n');
}