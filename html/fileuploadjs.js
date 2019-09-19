/*global bootbox toastr*/
/*eslint no-undef: "error"*/

var server = null;
if(window.location.protocol === 'http:')
    server = "http://" + window.location.hostname + ":8088/janus";
else
    server = "https://" + window.location.hostname + ":8089/janus";

var opaqueId = "echotest-"+Janus.randomString(12);

var bitrateTimer = null;
var spinner = null;

var fileUpload = {
    session: null,
    plugin: null,

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
                // Negotiate WebRTC
                var body = { "audio": false, "video": false, "data": false };

                Janus.debug("Sending message (" + JSON.stringify(body) + ")");
                me.plugin.send({"message": body});
                Janus.debug("Trying a createOffer too (audio/video sendrecv)");
                me.plugin.createOffer({
                    
                    media: { audio: false, video: false, data: true },    // Let's negotiate data channels as well

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

                $('#start').removeAttr('disabled').html("Stop")
                    .click(function() {
                        $(this).attr('disabled', true);
                        if(bitrateTimer)
                            clearInterval(bitrateTimer);
                        bitrateTimer = null;
                        me.session.destroy();
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
                $("#videoleft").parent().unblock();
            },
            slowLink: function(uplink, lost) {
                Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
                    " packets on this PeerConnection (" + lost + " lost packets)");
            },
            onmessage: function(msg, jsep) {
                Janus.debug(" ::: Got a message :::");
                Janus.debug(msg);
                if(jsep !== undefined && jsep !== null) {
                    Janus.debug("Handling SDP as well...");
                    Janus.debug(jsep);
                    me.plugin.handleRemoteJsep({jsep: jsep});
                }
                var result = msg["result"];
                if(result !== null && result !== undefined) {
                    if(result === "done") {
                        // The plugin closed the echo test
                        bootbox.alert("The Echo Test is over");
                        if(spinner !== null && spinner !== undefined)
                            spinner.stop();
                        spinner = null;
                        $('#myvideo').remove();
                        $('#waitingvideo').remove();
                        $('#peervideo').remove();
                        $('#toggleaudio').attr('disabled', true);
                        $('#togglevideo').attr('disabled', true);
                        $('#bitrate').attr('disabled', true);
                        $('#curbitrate').hide();
                        $('#curres').hide();
                        return;
                    }
                    // Any loss?
                    var status = result["status"];
                    if(status === "slow_link") {
                        //~ var bitrate = result["bitrate"];
                        //~ toastr.warning("The bitrate has been cut to " + (bitrate/1000) + "kbps", "Packet loss?", {timeOut: 2000});
                        toastr.warning("Janus apparently missed many packets we sent, maybe we should reduce the bitrate", "Packet loss?", {timeOut: 2000});
                    }
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
                $('#videos').removeClass('hide').show();
                $('#datasend').removeAttr('disabled');
            },
            ondata: function(data) {
                Janus.debug("We got data from the DataChannel! " + data);
                $('#datarecv').val(data);
            },
            oncleanup: function() {
                Janus.log(" ::: Got a cleanup notification :::");
                if(spinner !== null && spinner !== undefined)
                    spinner.stop();
                spinner = null;
                if(bitrateTimer)
                    clearInterval(bitrateTimer);
                bitrateTimer = null;
                $('#myvideo').remove();
                $('#waitingvideo').remove();
                $("#videoleft").parent().unblock();
                $('#peervideo').remove();
                $('#toggleaudio').attr('disabled', true);
                $('#togglevideo').attr('disabled', true);
                $('#bitrate').attr('disabled', true);
                $('#curbitrate').hide();
                $('#curres').hide();
                $('#datasend').attr('disabled', true);
                $('#simulcast').remove();
            }
        });
    },

    sendData: function() {
        var me = this;
        var data = $('#datasend').val();
        if(data === "") {
            bootbox.alert('Insert a message to send on the DataChannel');
            return;
        }
        me.plugin.data({
            text: data,
            error: function(reason) { bootbox.alert(reason); },
            success: function() { $('#datasend').val(''); },
        });

    },

    checkEnter: function(event) {
        var me = this;
        var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
        if(theCode == 13) {
            me.sendData();
            return false;
        } else {
            return true;
        }
    }
};

$(document).ready(function() {
    fileUpload.init();
});