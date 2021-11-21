#!/usr/bin/node

const fs = require('./client');
const { exit } = require('process');

// argv processing
const argv = processArgv(process.argv.slice(2));

// debugging
if (argv.debug) {
  console.log('DEBUG OUTPUT ON');
}

if (argv.debug) { console.log('argv: ', argv); }

if (argv.help || (process.argv.length <= 2 || argv._length <= 0 || argv._[0] === 'help')) { // if help or no args
  printHelp();
  exit(0);
}

if (argv._.length > 0) {
  fs.init(undefined, argv.multicastPort, undefined, undefined, undefined, undefined, undefined, argv.debug);
  switch (argv._[0].toLowerCase()) {
    case 'get':
      argv._ = argv._.slice(1);
      argv._.forEach(arg => {
        fs.get(arg);
      });
      break;
    case 'put':
      argv._ = argv._.slice(1);
      argv._.forEach(arg => {
        fs.put(arg, argv.bucket, !argv.noEncryption);
      });
      break;
    default:
      throw new Error(`Unrecognized command: ${argv._[0]}`);
  }
}

/**
Parses the process arguments and creates an argv
variable containing argument data. Changes global
variables based on the arguments passed in.
*/
function processArgv (args) {
  const argv = {
    _: [],
    outputFiles: []
  };
  let error = null;
  args.forEach(arg => {
    if (error) {
      throw new Error(`Invalid parameter: ${error}`);
    }
    [symbol, params] = arg.split('=');
    switch (symbol) {
      // flags
      case '--help':
        argv.help = true;
        break;
      case '-d':
      case '--debug':
        if (params == undefined) { argv.debug = true; } else { error = arg; }
        break;
      case '-n':
      case '--noEncryption':
        if (params == undefined) { argv.noEncryption = true; } else { error = arg; }
        break;

        // args
      case '-p':
      case '--port':
        if (params && !isNaN(params)) { argv.multicastPort = Number(params); } else { error = arg; }
        break;
      case '-o':
      case '--outputFiles':
        if (params) { argv.outputFiles = params.split(','); } else { error = arg; }
        break;
      case '-b':
      case '--bucket':
        if (params) { argv.bucket = params; } else { error = arg; }
        break;

        // command or command arg
      default:
        if (!symbol.startsWith('-')) { argv._.push(symbol); } else { error = arg; }
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
function printHelp () {
  console.log('Usage: <command> <param>... [-p, --port=portNumber] [-d, --debug]\n' +
                '      command = GET | PUT\n' +
                '      param = fileKey | filepath\n' +
                '      port (-p): port multicast client binds and sends to\n' +
                '      debug (-d): displays debugging output\n' +
                '\n' +
                '      GET <fileKey>... [-o, --outputFiles=fileName1,...]\n' + // fileKey will contain uuid and aes key and iv
                '      fileKey = file identifier; found in log file after uploading with PUT\n' +
                '      outputFiles (-o): names to save downloaded files as (leave empty for default e.g. fileName1,,fileName3)\n' +
                '\n' +
                '      PUT <filepath>... [-b, --bucket=bucket] [-n, --noEncryption]\n' +
                '      filepath = path to file for uploading\n' +
                '      bucket (-b): bucket to upload file into\n' +
                '      noEncryption (-n): uploads unencrypted file contents\n'
  );
}
