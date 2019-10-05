// This is a simple example of an file upload application built in JavaScript,
// and conceived to be used in conjunction with the janus_duktape.c plugin.

/*global getModulesFolder Duktape readFile readFileChunk writeFile pushEvent notifyEvent configureMedium pokeScheduler getDuktapeVersion relayData removeRecipient */
/*eslint no-undef: "error"*/

// Example details
const name = "fileupload.js";

// Let's add more info to errors
Error.prototype.toString = function () {
    return this.name + ': ' + this.message + ' (at line ' + this.lineNumber + ')';
};
// Let's add a prefix to all console.log lines
var originalConsoleLog = console.log;
console.log = function() {
    var args = [];
    args.push('[\x1b[36m' + name + '\x1b[0m] ');
    for(var i=0; i<arguments.length; i++) {
        args.push(arguments[i]);
    }
    originalConsoleLog.apply(console, args);
};

console.log("Loading script using Duktape v. " + getDuktapeVersion() + "...");

// We'll import our own hacky SDP parser, so we'll need the folder from the core
var folder = getModulesFolder();
console.log('Modules folder:', folder);

// To require external modules with Duktape, we need a modSearch function:
// https://github.com/svaarala/duktape-wiki/blob/master/HowtoModules.md
Duktape.modSearch = function(id) {
    console.log('Loading module:', id);
    // We read the file from the folder the core returned
    var res = readFile(folder + '/' + id + '.js');
    if(typeof res === 'string') {
        console.log('Module loaded');
        return res;
    }
    throw new Error('Module not found: ' + id);
};

// Let's import our ugly SDP parser now
var sdpUtils = require("janus-sdp");

var fileUpload = {
    version: 1,
    versionString: "0.0.1",
    description: "This is fileupload.js, a JavaScript/Duktape to upload files over Data Channel",
    name: "JavaScript File Upload",
    author: "Chris Maciejewski",
    package: "janus.plugin.fileupload",
    sessions: {},
    tasks: [],
    init: function(config) {
        // This is where we initialize the plugin, for static properties
        console.log("Initializing...");
        if (config) {
            console.log("Configuration file provided (" + config + "), but we don't need it");
        }
        console.log("Initialized");
        // Just for fun (and to showcase the feature), let's send an event to handlers:
        // notice how the first argument is 0, meaning this event is not tied to any session
        var event = { event: "loaded", script: name };
        notifyEvent(0, JSON.stringify(event));
    },
    createSession: function(id) {
        var me = this;
        // Keep track of a new session
        console.log("Created new session:", id);
        me.sessions[id] = { 
            id: id,
            type: null
        };
    },
    destroySession: function(id) {
        var me = this;
        // A Janus plugin session has gone
        console.log("Destroyed session:", id);
        hangupMedia(id);
        delete me.sessions[id];
    },
    querySession: function(id) {
        var me = this;
        // Return info on a session
        console.log("Queried session:", id);
        var s = me.sessions[id];
        if(!s)
            return null;
        var info = { script: s["lua"], id: s["id"] };
        return JSON.stringify(info);
    },
    handleMessage: function(id, tr, msg, jsep) {
        var me = this;
        // Handle a message, synchronously or asynchronously, and return
        // something accordingly: if it's the latter, we'll do a coroutine
        console.log("Handling message for session: ["+id+"]: " + msg + ", tr: ["+tr+"], jsep: ["+jsep+"]");
        var s = me.sessions[id];
        if (!s) {
            // Session not found: return value is a negative integer
            console.error("Session ["+id+"] not found");
            return -1;
        }

        msg = JSON.parse(msg);
        
        if (jsep) {
            // We'll need a coroutine here: the scheduler will resume it later
            me.tasks.push({ id: id, tr: tr, msg: msg, jsep: JSON.parse(jsep) });
            // Return explaining that this is will be handled asynchronously
            pokeScheduler();
            // Asynchronous response: return value is a positive integer
            return 1;
        } else {
            // Let's return a synchronous response if there's no jsep, asynchronous otherwise
            return JSON.stringify(me.processRequest(id, msg));
        }
    },
    handleAdminMessage: function(message) {
        // This is just to showcase how you can handle incoming messages
        // coming from the Admin API: we return the same message as a test
        console.log("Got admin message:", message);
        return message;
    },
    sendChunk: function(session) {

        if (session.send_status == 'completed') {
            return;
        }

        session.offset = session.len * session.chunk;

        console.log("readFileChunk session.offset ["+session.offset+"], session.len ["+session.len+"]");

        var buf = readFileChunk(session.path, session.offset, session.len);

        if (buf === -1) {
            session.send_status = 'completed';
            console.log("readFileChunk returned no data");
            pushEvent(session.id, null, JSON.stringify({ info: "File download completed", result: 'completed' }));
            return;
        }

        relayData(session.id, buf, buf.length);

        session.chunk++;

        console.log("sendChunk ["+session.chunk+"] completed");
    },
    setupMedia: function(id) {
        // WebRTC is now available
        var me = this,
            session = me.sessions[id];

        if (!session) {
            console.error("Unable to handle setupMedia for ["+id+"] as sesson is not set");
            return;
        }

        console.log("WebRTC PeerConnection is up for session:", id);

        if (session.type == 'filedownload') {
            
            if (!session.path) {
                pushEvent(id, null, JSON.stringify({ info: "Path not set, unable to read file", result: 'error' }));
                return;
            }

            session.send_status = 'sending';
            session.len = 64000;
            session.offset = 0;
            session.chunk = 0;

            // send first chunk, next ones will be sent once we get ACK from the client
            me.sendChunk(session);

        }
    },
    hangupMedia: function(id) {
        var me = this;
        // WebRTC not available anymore
        console.log("WebRTC PeerConnection is down for session:", id);
        // Detach the stream
        removeRecipient(id, id);
        // Clear some flags
        var s = me.sessions[id];
        if (s) {
            s.audioCodec = null;
            s.videoCodec = null;
        }
    },
    incomingData: function(id, buf, len) {
        console.log('incomingData ['+id+'] len: ['+len+']');

        var me = this,
            session = me.sessions[id];

        if (!session) {
            console.error("Unable to handle incomingData for ["+id+"] as sesson is not set");
            return;
        }

        if (!session.type) {
            console.error("Session type not set, unable to handle incoming data for ["+id+"]");
            return;
        }

        if (session.type == 'fileupload') {
            if (!session.savepath) {
                console.error("Save path not set yet for ["+id+"], unable to handle incoming data");
                return;
            }

            if (!session.chunks) {
                console.error("Chunks not set yet for ["+id+"], unable to handle incming data");
                return;
            }

            if (session.chunkCount) {
                session.chunkCount++;
            } else {
                session.chunkCount = 1;
            }

            writeFile(session.savepath, buf);

            console.log('saved data of chunk ['+session.chunkCount+'] for session id ['+id+'] len: ['+len+']');

            if (session.chunkCount === session.chunks) {
                console.log('File upload completed');
                pushEvent(id, null, JSON.stringify({ info: "File upload completed", result: 'completed' }));
            }

        } else if (session.type == 'filedownload') {
            console.log('##### DATA ['+buf+']');
            console.log('Session chunk: ' + session.chunk);
            if (buf == 'ack-' + (session.chunk - 1)) {
                me.sendChunk(session);
            }
        } else {
            console.error("Don't know how to handle incoming data for session type ["+session.type+"] Id ["+id+"]");
            return;
        }
    },
    resumeScheduler: function() {
        var me = this;
        // This is the function responsible for resuming coroutines associated
        // with whatever is relevant to the JS script, e.g., for this script,
        // with asynchronous requests: if you're handling async stuff yourself,
        // you're free not to use this and just return, but the C Duktape plugin
        // expects this method to exist so it MUST be present, even if empty
        console.log("Resuming coroutines");
        for(var index in me.tasks) {
            var task = me.tasks[index];
            me.processAsync(task);
        }
        console.log("Coroutines resumed");
        me.tasks = [];
    },
    processAsync: function(task) {
        var me = this;
        // We'll only execute this when the scheduler resumes a task
        var id = task.id;
        var tr = task.tr;
        var msg = task.msg;
        var jsep = task.jsep;
        console.log("Handling async message for session:", id);
        var s = me.sessions[id];
        if(!s) {
            console.log("Can't handle async message: no such session");
            return;
        }
        var offer = sdpUtils.parse(jsep.sdp);
        console.log("Got offer:", offer);
        var answer = sdpUtils.generateAnswer(offer, { audio: true, video: true, data: true });
        console.log("Generated answer:", answer);
        console.log("Processing request:", msg);
        me.processRequest(id, msg);
        console.log("Pushing event:");
        var event = { filetransfer: "event", result: "ok" };
        console.log("  --", event);
        var jsepanswer = { type: "answer", sdp: sdpUtils.render(answer) };
        console.log("  --", jsepanswer);
        pushEvent(id, tr, JSON.stringify(event), JSON.stringify(jsepanswer));
        // Just for fun (and to showcase the feature), let's send an event to handlers;
        // notice how we pass the id now, meaning this event is tied to a specific session
        event = { event: "processed", request: msg };
        notifyEvent(id, JSON.stringify(event));
    },
    processRequest: function(id, msg) {
        var me = this,
            response = {
                info: "Unknown Error",
                result: "error"
            };

        if (!msg) {
            response.info = "Unable to process request with empty msg parameter";
            console.error(response.info);
            return response;
        }

        var session = me.sessions[id];

        if (!session) {
            response.info = "Session ["+id+"] not found";
            console.error(response.info);
            return response;
        }

        console.log('processRequest ['+id+'], ' + JSON.stringify(msg));

        if (msg.session_type) {
            if (session.type) {
                response.info = "Session type is already set. Unable to change.";
                console.error(response.info);
                return response;
            }

            if (msg.session_type == 'fileupload') {
                me.sessions[id]['type'] = 'fileupload';
                configureMedium(id, "data", "in", true);
                configureMedium(id, "data", "out", true);
                return { info: "Session type set to " + msg.session_type, result: "ok" };
            } else if (msg.session_type == 'filedownload') {
                me.sessions[id]['type'] = 'filedownload';
                if (msg.path) {
                    me.sessions[id]['path'] = msg.path;
                }
                configureMedium(id, "data", "in", true);
                configureMedium(id, "data", "out", true);
                return { info: "Session type set to " + msg.session_type, result: "ok" };
            } else {
                response.info = "Unable to set Session Type to ["+msg.session_type+"]";
                console.error(response.info);
                return response;
            }
        } else {
            if (!session.type) {
                response.info = "Please set session_type before sending further requests";
                console.error(response.info);
                return response;
            }

            if (session.type == 'fileupload') {
                return me.handleFileupload(session, msg);
            } else if (session.type == 'filedownload') {
                return me.handleFiledownload(session, msg);
            } else {
                response.info = "Don't know how to handle session.type ["+session.type+"]";
                console.error(response.info);
                return response;
            }
        }
    },
    handleFileupload: function(session, msg) {
        var me = this,
            info = [],
            response = {
                info: "Fileupload unknown Error",
                result: "error"
            };

        if (msg.savepath) {
            me.sessions[session.id]['savepath'] = msg.savepath;
            info.push("Save path set to [" + msg.savepath + ']');
        }

        if (msg.chunks) {

            if (!/^[1-9][0-9]{0,20}$/.test(msg.chunks)) {
                me.sessions[session.id]['chunks'] = null;
                response.info = "Invalid chunks ["+msg.chunks+"]";
                console.error(response.info);
                return response;
            }

            me.sessions[session.id]['chunks'] = parseInt(msg.chunks);
            info.push("File to be received in [" + msg.chunks + "] chunks");
        }

        if (info.length) {
            return { info: info.join(", "), result: "ok" };
        }

        response.info = "Don't know how to handle fileupload message ["+JSON.stringify(msg)+"]";
        console.error(response.info);
        return response;
    },
    handleFiledownload: function(session, msg) {
        var me = this,
            response = {
                info: "Filedownload unknown Error",
                result: "error"
            };

        if (msg.path) {
            me.sessions[session.id]['path'] = msg.path;
            return { info: "Download path set to [" + msg.path + ']', result: "ok" };
        }

        response.info = "Don't know how to handle filedownload message ["+JSON.stringify(msg)+"]";
        console.error(response.info);
        return response;
    },
    slowLink: function(p1, p2, p3) {
        console.log("#### SLOW LINK ###");
        console.log(p1);
        console.log(p2);
        console.log(p3);
        console.log("####################");
    },
    destroy: function() {
        // This is where we deinitialize the plugin, when Janus shuts down
        console.log("Deinitialized");
    }
};

// JS -> C methods
function getVersion() { // eslint-disable-line no-unused-vars
    return fileUpload.version;
}
function getVersionString() { // eslint-disable-line no-unused-vars
    return fileUpload.versionString;
}
function getDescription() { // eslint-disable-line no-unused-vars
    return fileUpload.description;
}
function getName() { // eslint-disable-line no-unused-vars
    return fileUpload.name;
}
function getAuthor() { // eslint-disable-line no-unused-vars
    return fileUpload.author;
}
function getPackage() { // eslint-disable-line no-unused-vars
    return fileUpload.package;
}
function init(config) { // eslint-disable-line no-unused-vars
    fileUpload.init(config);
}
function destroy() { // eslint-disable-line no-unused-vars
    fileUpload.destroy();
}
function createSession(id) { // eslint-disable-line no-unused-vars
    fileUpload.createSession(id);
}
function destroySession(id) { // eslint-disable-line no-unused-vars
    fileUpload.destroySession(id);
}
function querySession(id) { // eslint-disable-line no-unused-vars
    return fileUpload.querySession(id);
}
function handleMessage(id, tr, msg, jsep) { // eslint-disable-line no-unused-vars
    return fileUpload.handleMessage(id, tr, msg, jsep);
}
function handleAdminMessage(message) { // eslint-disable-line no-unused-vars
    return fileUpload.handleAdminMessage(message);
}
function setupMedia(id) { // eslint-disable-line no-unused-vars
    fileUpload.setupMedia(id);
}
function hangupMedia(id) {
    fileUpload.hangupMedia(id);
}
function incomingData(id, buf, len) { // eslint-disable-line no-unused-vars
    fileUpload.incomingData(id, buf, len);
}
function slowLink(p1, p2, p3) { // eslint-disable-line no-unused-vars
    fileUpload.slowLink(p1, p2, p3);
}
function resumeScheduler() { // eslint-disable-line no-unused-vars
    fileUpload.resumeScheduler();
}

// Done
console.log("Script loaded");
