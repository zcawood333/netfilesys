# netfilesys
Network-based file system using multicast to asynchronously communicate with servers to download files, upload files, and share information.
## Server
Listens on a given addr:port and multicast address for incoming http requests and multicast messages.

### To Run
```
node server.js
```
### Uploading files
An http PUT request to addr:port/upload will result in an uploaded file consisting of the contents of the PUT request's body. The server will return the generated UUID the file is stored under and log the event in an upload log file.
### Downloading files
An http GET request to addr:port/download/UUID, where UUID is a valid UUID returned from a successful upload, will download the file saved there. The server logs the event in a download log file.
### Buckets
Buckets are different storage types on the server that clients can choose from depending on their needs.
#### Default(default) Bucket
Simply stores the file in the uploads folder. Used when client's bucket is undefined or invalid.
#### Standard(std) Bucket
Basic storage in the std/ folder.
#### Temporary(tmp*) Bucket
Stores the file in a tmp*/ folder, where * is the life of the file before deletion. Used to save server space on files that are only needed temporarily. Available tmp buckets can be configured in netfilesys/server/buckets.js. e.g. Any file uploaded to the tmp4 bucket will be removed after 4 minutes. 
#### Quick(quick) Bucket
Stores the file in a quick/ folder. This folder is always searched first for files and all files in the folder are stored as buffers in memory.
## Client
Command line utility to upload and download files from a server.
### To Run
```
node client.js help\
node client.js GET \<fileKey>...\
node client.js PUT \<filePath>...
```
### Commands
#### GET
The GET command will parse each fileKey for necessary information. It then sends a multicast message to subscribed servers to look for the file. If a server responds that it has the file, the client initiates an HTTP GET request to that server, automatically decrypting the file if necessary, and saves it to an output file.
##### FileKeys
FileKeys are used by the GET command to retrieve a file from a server. They are stored in an upload log file.\
If the uploaded file was not encrypted, it is composed of the UUID the server returned during the upload.\
If the file was encrypted, it is concatenated with a client-generated UUID and initialization vector used during encryption.
##### Output Files
When using the GET command, the downloaded files will use their fileKey as their default download fileName. To override the default, the flag -o/--outputFiles=fileName1,... will save the corresponding downloaded files to that fileName. An empty fileName (fileName1,,fileName3) will use the default.
#### PUT
The PUT command will determine the size of each file to upload and sends a multicast message with the information. If a server responds that it has the necessary storage, the client will initiate an HTTP PUT request to the server with the file at filePath's contents as its body. It includes a header containing the bucket request, and if possible, the server will save the file under that bucket. It logs the event and the generated fileKey.
##### Encryption
Files are by default encrypted before they are uploaded. This can be overridden by setting the -n/--noEncryption flag.
##### Buckets
The -b/--bucket=bucket flag will upload the file to that bucket on the server. If the bucket is not specified, or is invalid, the server will use its default.
### Other Flags
#### Port
-p/--port=portNumber sets the multicast port the client will send messages to and listen on.
#### Debug
-d/--debug turns on debugging output.

# Developer
//work in progress

## Examples

### Client Node Example

```javascript
fs = require("netfilesys-client");

fs.init(host, time, .....);  // none this needed, if you just use the defaults.

// async
fs.put('example.jpg', function(key, error) {
  if (key) {
    fs.set_timeout(10);
    fs.get(key, filename, function(err) {
      console.log('got the file back');
    });
  }
});
fs.put('example2.jpg', function(key, error) {
  console.log('File 2 got stored too!');
}

fs.wait(function() {
    // syncronous
    var key = fs.sync_put('example.jpg');
    fs.sync_get(key, filename);
  }
);


```
### Client C Example
```C
#include netfilesys.h

int main() {
  char *key;
  void *fs;
 
  fs = netfilesys_init();
  netfilesys_set_cluster(fs, "230.185.192.108");  // cluster ip. this is optional since it is this by default.
  netfilesys_set_timeout(fs, 3);                  // timeout in seconds
  
  key = fs_get(fs, "example.jpg");
  if (key) {
    fs_put(fs, key, "fetched-example.jpg");
  } else {
    printf("Error");
  }
}

```

### Server Plugin Example

The server has the ability to have plugins to handle requests for files that are not found.  The folder plugins is loaded from the plugins directory.  Any request is passed to the Resolve() function if the key is not found.

Example plugin:
```javascript
function resolve(URL) {
  //fetch the file from google images randomly.
  // return the pipe() to the connection to images so the client gets the file.
}

module.exports.resolve = resolve
```
