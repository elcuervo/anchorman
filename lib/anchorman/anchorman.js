// Shims
navigator.getUserMedia = (navigator.getUserMedia   ||
                         navigator.mozGetUserMedia ||
                         navigator.msGetUserMedia  ||
                         navigator.webkitGetUserMedia);

var RTCPeerConnection = (this.RTCPeerConnection      ||
                         this.webkitRTCPeerConnection ||
                         this.mozRTCPeerConnection);

var RTCSessionDescription = (this.RTCSessionDescription ||
                             this.RTCSessionDescription  ||
                             this.mozRTCSessionDescription);

var RTCIceCandidate = (this.RTCIceCandidate ||
                       this.RTCIceCandidate ||
                       this.mozRTCIceCandidate);

(function() {
  var Anchorman = function Anchorman(transportUrl) {
    this.transportUrl = transportUrl;

    this.config = {
      defaultEvents: {
        iceCandidate: "anchorman:icecandidate",
        offer:        "anchorman:offer",
        answer:       "anchorman:answer"
      },

      network: {
        iceServers: [ { url: "stun:stun.l.google.com:19302" } ]
      },

      connection: {
        optional: [ { RtpDataChannels: true } ]
      }
    };

    var transportConstructor = Anchorman.Transport.WebSocket;
    this.transport = new transportConstructor(transportUrl);
    this.connection = new Anchorman.Connection(this);
  };

  Anchorman.Transport = function() {
    this.events = {};
    RSVP.EventTarget.mixin(this.events);
  };

  Anchorman.Transport.prototype = {
    on: function(name, fn) { this.events.on(name, fn); },
    off: function(name, fn) { this.events.off(name, fn); },
    trigger: function(name, object) { this.events.trigger(name, object); },

    connect: function() {},
    receive: function() {},
    send: function() {}
  };

  Anchorman.Transport.WebSocket = function(url) {
    this.events = {};
    self = this;

    RSVP.EventTarget.mixin(this.events);

    this.connection = new WebSocket(url);
    console.log("Websocket connected");

    this.connection.onmessage = function(event) {
      var data = JSON.parse(event.data);
      console.log("transport::event received " + data["type"]);

      self.events.trigger(data["type"], data["data"]);
    }
  };

  Anchorman.Transport.WebSocket.prototype = {
    on: function(name, fn) { this.events.on(name, fn); },
    trigger: function(event, data) {
      var message = { type: event, data: data };
      var encoded = JSON.stringify(message)

      console.log("transport::event sent " + event);

      this.connection.send(encoded);
    },
  };

  Anchorman.Connection = function(anchorman) {
    var connected = new Q.defer();

    this.socket = new RTCPeerConnection(anchorman.config.network, anchorman.config.connection);
    this.established = connected.promise;
    this.activeChannels = {};
    this.state = "initial";

    this.dataChannel("anchorman:latency");

    this.anchorman = anchorman;
    this.transport = anchorman.transport;

    this.channels = Anchorman.Util.bind(function(name) {
      if(this.activeChannels.hasOwnProperty(name)) {
        return this.activeChannels[name];
      } else {
        return this.activeChannels[name] = this.dataChannel(name);
      }
    }, this);

    this.socket.oniceconnectionstatechange = Anchorman.Util.bind(function() {
      var state = this.socket.iceConnectionState;
      this.state = state;

      console.log("connection::state", state);
      if(state === "connected") {
        connected.resolve();
      }
    }, this);

    this.socket.onsignalingstatechange = function() {
      console.log(" >> signal", this.signalingState);
    }

    this.socket.onicecandidate = Anchorman.Util.bind(function(candidate) {
      var eventName = this.anchorman.events.iceCandidate;

      this.transport.trigger(eventName, candidate.candidate);
    }, this);

    this.transport.on(anchorman.events.iceCandidate, Anchorman.Util.bind(function(candidate) {
      if(candidate.candidate) {
        var candidateObject = new RTCIceCandidate(candidate);
        this.socket.addIceCandidate(candidateObject)
      } else {
        console.log("No moar candidates");
      }
    }, this));

    this.transport.on(anchorman.events.offer, Anchorman.Util.bind(function(offer) {
      console.log("incoming offer");
      var description = new RTCSessionDescription(offer);

      this.socket.setRemoteDescription(description);
      this.answer();
    }, this));

    this.transport.on(anchorman.events.answer, Anchorman.Util.bind(function(answer) {
      console.log("incoming answer");
      var description = new RTCSessionDescription(answer);
      this.socket.setRemoteDescription(description);
    }, this));

    this.socket.onremovestream = function() {
      console.log("stream removed");
    }
  };

  Anchorman.Connection.prototype = {
    dataChannel: function(name) {
      // Reliable channels are not implemented yet.
      var channel = this.socket.createDataChannel(name, { reliable: false });
      return channel;
    },

    addStream: function(stream) {
      this.socket.addStream(stream);
    },

    receiveStream: function(fn) {
      this.socket.onaddstream = fn;
    },

    answer: function() {
      this.socket.createAnswer(Anchorman.Util.bind(function(answer) {
        this.socket.setLocalDescription(answer);
        this.transport.trigger(this.anchorman.events.answer, answer);
      }, this));
    },

    offer: function() {
      this.socket.createOffer(Anchorman.Util.bind(function(offer) {
        var eventName = this.anchorman.events.offer;

        this.socket.setLocalDescription(offer);
        this.transport.trigger(eventName, offer);
      }, this));
    },
  };

  Anchorman.Stream = function(anchorman) {
    this.config = {
      stream: { video: true, audio: true },
      share: {
        video: { mandatory: { chromeMediaSource: "screen" } },
        audio: false
      }
    }
    this.connection = anchorman.connection;

    this.startStreaming = function(stream) {
      this.connection.addStream(stream);
      this.connection.offer();
    };

    this.videoExchange = function(type, fn) {
      var defer = Q.defer();

      navigator.getUserMedia(this.config[type], Anchorman.Util.bind(function(stream) {
        this.startStreaming(stream);
        defer.resolve(stream);
      }, this), function(error) { defer.reject(error) });

      defer.promise.then(fn);
    }
  };

  Anchorman.Stream.prototype = {
    receive: function(fn) { this.connection.receiveStream(fn); },

    broadcast: function(fn) { this.videoExchange("stream", fn); },

    share: function(fn) { this.videoExchange("share", fn); },
  };

  Anchorman.Util = {
    bind: function(fn, context) {
      return Function.prototype.bind.call(fn, context);
    }
  };

  Anchorman.prototype = {
    // Adds events= method to sets new methods names
    //
    set events(eventHash) {
      for(var key in this.config.defaultEvents) {
        if(eventHash.hasOwnProperty(key)) {
          this.config.defaultEvents[key] = eventHash[key];
        }
      }

      return this.defaultEvents;
    },

    // Access the named events
    //
    get events() { return this.config.defaultEvents; },

    get stream() {
      if(!this._stream) this._stream = new Anchorman.Stream(this);
      return this._stream;
    },

    get camera() { return this.stream },
    get screen() {
      if(!location.protocol.match('https')) {
        console.error("Screen sharing is only allowed when the scheme is https")
      } else {
        return this.stream
      }
    },

    channels: function(name) {
      return this.connection.channels(name);
    },

    data: function() {
      return this.connection.offer();
    },

    ready: function(fn) {
      return this.connection.established.then(fn);
    }

  };

  window.Anchorman = Anchorman;
})();
