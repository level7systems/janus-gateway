/*global bootbox Janus*/
/*eslint no-undef: "error"*/
const BYTES_PER_CHUNK = 48000;

var server = null;
if(window.location.protocol === 'http:')
    server = "http://" + window.location.hostname + ":8088/janus";
else
    server = "https://" + window.location.hostname + ":8089/janus";

var opaqueId = "echotest-"+Janus.randomString(12);

var fileUpload = {
    session: null,
    plugin: null,
    fileReader: null,

    init: function() {
        var me = this;

        Janus.init({debug: "all", callback: function() {
            // Use a button to start the demo
            $('#start').one('click', function() {
                $(this).attr('disabled', true).unbind('click');
                // Make sure the browser supports WebRTC
                if(!Janus.isWebrtcSupported()) {
                    bootbox.alert("No WebRTC support... ");
                    return;
                }

                me.createSession();
            });
        }});
    },
    createSession: function() {
        var me = this;

        me.session = new Janus({
            server: server,
            success: function() {
                me.attachPlugin();
            },
            error: function(error) {
                Janus.error(error);
                bootbox.alert(error, function() {
                    window.location.reload();
                });
            },
            destroyed: function() {
                window.location.reload();
            }
        });
    },

    attachPlugin: function() {
        var me = this;

        me.session.attach({
            plugin: "janus.plugin.fileupload",
            opaqueId: opaqueId,
            success: function(pluginHandle) {
                $('#details').remove();
                me.plugin = pluginHandle;
                Janus.log("Plugin attached! (" + me.plugin.getPlugin() + ", id=" + me.plugin.getId() + ")");
                
                // Negotiate WebRTC, we only need data
                var body = { session_type: 'fileupload' };
                me.plugin.send({ "message": body });

                Janus.debug("Trying a createOffer for Data Channel");
                me.plugin.createOffer({
                    media: { 
                        audio: false, 
                        video: false, 
                        data: true
                    },
                    simulcast: false,
                    simulcast2: false,
                    success: function(jsep) {
                        Janus.debug("Got SDP!");
                        Janus.debug(jsep);
                        me.plugin.send({"message": body, "jsep": jsep});
                    },
                    error: function(error) {
                        Janus.error("WebRTC error:", error);
                        bootbox.alert("WebRTC error... " + JSON.stringify(error));
                    }
                });
            },
            error: function(error) {
                console.error("  -- Error attaching plugin...", error);
                bootbox.alert("Error attaching plugin... " + error);
            },
            consentDialog: function(on) {
                Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
                if(on) {
                    // Darken screen and show hint
                    $.blockUI({
                        message: '<div><img src="up_arrow.png"/></div>',
                        css: {
                            border: 'none',
                            padding: '15px',
                            backgroundColor: 'transparent',
                            color: '#aaa',
                            top: '10px',
                            left: (navigator.mozGetUserMedia ? '-100px' : '300px')
                        } });
                } else {
                    // Restore screen
                    $.unblockUI();
                }
            },
            iceState: function(state) {
                Janus.log("ICE state changed to " + state);
            },
            mediaState: function(medium, on) {
                Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
            },
            webrtcState: function(on) {
                Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
            },
            slowLink: function(uplink, lost) {
                Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
                    " packets on this PeerConnection (" + lost + " lost packets)");
            },
            onmessage: function(msg, jsep) {
                Janus.debug(" ::: Got a message :::");
                Janus.debug(msg);
                if (jsep !== undefined && jsep !== null) {
                    Janus.debug("Handling SDP as well...");
                    Janus.debug(jsep);
                    me.plugin.handleRemoteJsep({jsep: jsep});
                }
            },
            onlocalstream: function(stream) {
                Janus.debug(" ::: Got a local stream :::");
                Janus.debug(stream);
            },
            onremotestream: function(stream) {
                Janus.debug(" ::: Got a remote stream :::");
                Janus.debug(stream);
            },
            ondataopen: function(data) {
                Janus.log("The DataChannel is available!");
                $('#fileupload').removeClass('hide').show();
            },
            ondata: function(data) {
                Janus.debug("We got data from the DataChannel! " + data);
                $('#datarecv').val(data);
            },
            oncleanup: function() {
                Janus.log(" ::: Got a cleanup notification :::");
            }
        });
    },

    readNextChunk: function(file, currentChunk) {
        var me = this;
        var start = BYTES_PER_CHUNK * currentChunk;
        var end = Math.min( file.size, start + BYTES_PER_CHUNK );
        me.fileReader.readAsArrayBuffer( file.slice( start, end ) );
    },

    arrayBufferToBase64: function(arrayBuffer) {
        var base64    = '';
        var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

        var bytes         = new Uint8Array(arrayBuffer);
        var byteLength    = bytes.byteLength;
        var byteRemainder = byteLength % 3;
        var mainLength    = byteLength - byteRemainder;

        var a, b, c, d;
        var chunk;

        // Main loop deals with bytes in chunks of 3
        for (var i = 0; i < mainLength; i = i + 3) {
            // Combine the three bytes into a single integer
            chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

            // Use bitmasks to extract 6-bit segments from the triplet
            a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
            b = (chunk & 258048)   >> 12; // 258048   = (2^6 - 1) << 12
            c = (chunk & 4032)     >>  6; // 4032     = (2^6 - 1) << 6
            d = chunk & 63;               // 63       = 2^6 - 1

            // Convert the raw binary segments to the appropriate ASCII encoding
            base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
        }

        // Deal with the remaining bytes and padding
        if (byteRemainder == 1) {
            chunk = bytes[mainLength];

            a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

            // Set the 4 least significant bits to zero
            b = (chunk & 3)   << 4; // 3   = 2^2 - 1

            base64 += encodings[a] + encodings[b] + '==';
        } else if (byteRemainder == 2) {
            chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

            a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
            b = (chunk & 1008)  >>  4; // 1008  = (2^6 - 1) << 4

            // Set the 2 least significant bits to zero
            c = (chunk & 15)    <<  2; // 15    = 2^4 - 1

            base64 += encodings[a] + encodings[b] + encodings[c] + '=';
        }
          
        return base64;
    },

    onUpload: function(event) {
        var me = this,
            button = $('#uploadButton'), 
            filesField = $('#files'),
            files = filesField.prop('files');
        Janus.debug("Processing onUpload event for " + files.length + " files");

        if (files.length === 0) {
            bootbox.alert('Please select file to upload.');
            return;
        }
    
        if (files.length > 1) {
            bootbox.alert('Only one file can be uploaded at the time.');
            return;
        }

        button.attr('disabled', true);
        filesField.attr('disabled', true);

        var file = files[0],
            chunksCount = Math.ceil(file.size / BYTES_PER_CHUNK),
            currentChunk = 0;

        console.log('#### need to send ' + chunksCount + ' cunks');

        var body = { "filename": file.name };

        Janus.debug("Sending message (" + JSON.stringify(body) + ")");
        me.plugin.send({
            message: body,
            success: function() {
                Janus.debug("Sending message success, proceed with file upload...");
                
                me.fileReader = new FileReader();

                me.fileReader.onload = function() {
                    me.plugin.data({
                        text: me.arrayBufferToBase64(me.fileReader.result),
                        success: function() {

                            currentChunk++;

                            console.log('-- uploaded chunk ' + currentChunk + ' of ' + chunksCount );
                            
                            if (BYTES_PER_CHUNK * currentChunk < file.size ) {
                                
                                var progress =  Math.ceil(currentChunk / chunksCount * 100);
                                $('#progress').text(progress + '% uploaded...');

                                me.readNextChunk(file, currentChunk);
                            } else {
                                Janus.debug('All chunks sent');
                                $('#progress').text('100% Completed');
                                $('#uploadButton').attr('disabled', false);
                                $('#files').attr('disabled', false);
                            }
                        },
                        error: function(reason) {
                            bootbox.alert(reason);
                            Janus.debug('Filed to send chunk ['+reason+']: ' + reason);
                        }
                    });
                };

                me.readNextChunk(file, currentChunk);
                
            },
            error: function(error) {
                Janus.debug('Filed transfer failed');
                button.attr('disabled', false);
                filesField.attr('disabled', false);
            }
        });        
    }
};

$(document).ready(function() {
    fileUpload.init();
});