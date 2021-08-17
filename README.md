# netfilesys
################################\
WORK IN PROGRESS\
################################\
Network-based file system using multicast to asynchronously communicate with servers to download files, upload files, and share information.
## Server
Listens on a given addr:port and multicast address for incoming http requests and multicast messages.

### To Run
node server.js
### Uploading files
An http PUT request to addr:port/upload will result in an uploaded file consisting of the contents of the PUT request's body. The server will return the generated UUID the file is stored under.

An http POST request to addr:port/upload with multipart/form-data with 'fileKey':fileContents will result in an uploaded file consisting of fileContents. The server will return the generated UUID the file is stored under.

For both requests, the server logs the event in an upload log file.
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
### Multicast
Used by the client to asynchronously find and download files. Server responds via unicast if it has the file the client is looking for. 
## Client
Command line utility to upload and download files from a server.
### To Run
node client.js help\
node client.js GET \<fileKey>...\
node client.js PUT \<fileToUpload>...\
node client.js POST \<fileToUpload>...
### FileKeys
FileKeys are used by the GET command to retrieve a file from a server. They are stored in an upload log file.\
If the uploaded file was not encrypted, it is composed of the UUID the server returned during the upload.\
If the file was encrypted, it is concatenated with a client-generated UUID and initialization vector used during encryption.
### Uploading files
Multiple files can be uploaded by specifying multiple file paths after the POST/PUT command.
#### Encryption
Files are by default encrypted before they are uploaded. This can be overridden by setting the -n/--noEncryption flag.
#### Commands
##### PUT
The PUT command will initiate an http PUT request to the server with the fileToUpload's encrypted contents as its body. It logs the event and the generated fileKey.
##### POST
The POST command will initiate an HTTP POST request to the server with the fileToUpload's encrypted contents in a key:value pair encoded as multipart/form-data. It logs the event and the generated fileKey.
##### Buckets
The -b/--bucket=bucket flag will upload the file to that bucket on the server. If bucket is not specified, the server will use its default.
### Downloading files
Multiple files can be downloaded by specifying multiple fileKeys after the GET command.
#### Encryption
The client determines whether or not the file was encrypted when uploaded depending on the fileKey. Encrypted files are automatically decrypted when saved.
#### GET
The GET command will parse the fileKey for the server UUID, the client UUID, and the initialization vector. It then sends a multicast message to subscribed servers to look for the file. If a server responds that it has the file, the client initiates an HTTP GET request to that server, automatically decrypting the file if necessary, and saves it to an output file.
##### Output Files
When using the GET command, the downloaded files will use their fileKey as their default download fileName. To override the default, the flag -o/--outputFiles=fileName1,... will save the corresponding downloaded files to that fileName. An empty fileName (fileName1,,fileName3) will use the default.
### Multicast
The client uses multicast to asynchronously poll subscribed servers for files it wants to download. A server will respond if it has the file, allowing the client to directly request the file from that server.
### Other Flags
#### Port
-p/--port=portNumber sets the multicast port the client will send messages to and listen on.
#### Debug
-d/--debug turns on debugging output.