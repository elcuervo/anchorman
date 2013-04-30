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

var constrains = {
  optional:[{ DtlsSrtpKeyAgreement: true }],
  mandatory: {
    OfferToReceiveAudio: true,
    OfferToReceiveVideo: true
  }
};

(function() {
  var Anchorman = function Anchorman(transportUrl) {
    this.transportUrl = transportUrl;
    this.connectionOptions = {
      "iceServers": [
        { "url": "stun:stun.l.google.com:19302" }
      ]
    };

    var transportConstructor = Anchorman.Transport.WebSocket;
    this.transport = new transportConstructor(transportUrl);
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

  Anchorman.Connection = function() {
    var BufferedQueue = function() {
      this.queue = [];
      this.consume = function(fn) {
        if(this.queue.length) {
          fn(this.queue[0]);
          this.queue.shift();
          this.consume(fn)
        }
      }
    };

    BufferedQueue.prototype = {
      set subscribe(fn) {
        this.consume(fn);
        this._subscribe = fn;
      },

      push: function(item) {
        !!this._subscribe ? this._subscribe(item) : this.queue.push(item);
      }
    };

    this.outgoingCandidates = new BufferedQueue;
    this.incomingCandidates = new BufferedQueue;
    this.connection = new RTCPeerConnection(Anchorman.connectionOptions);
    var connection = this.connection;

    console.log("Created connection");

    this.connection.onaddstream = function() {
      console.log("Stream added");
    }

    this.connection.onremovestream = function() {
      console.log("stream removed");
    }

    this.connection.ongatheringchange = function() {
      console.log(arguments);
    }

    this.connection.onstatechange = function() {
      console.log("state changed", arguments);
    }

    this.connection.onnegotiationneeded = function() {
      console.log("negotiation needed");
    }

    this.connection.onconnecting = function() {
      console.log("Connecting");
    }

    this.connection.oniceconnectionstatechange = function(event) {
      console.log(connection.iceState);
    };

    this.connection.onopen = function() {
      console.log("Connection Opened");
    }

    this.connection.onicecandidate = Function.prototype.bind.apply(function(event) {
      if(event.candidate) {
        this.outgoingCandidates.push(event.candidate);
      } else {
        console.log("No more candidates");
      }
    }, [this]);

  };

  Anchorman.Connection.prototype = {
    get offer() {
      var connection = this.connection;
      var defer = Q.defer();

      connection.createOffer(function(sessionDescription) {
        connection.setLocalDescription(sessionDescription)
        defer.resolve(sessionDescription);
      }, null, constrains);

      return defer.promise;
    },

    incoming: function(fn) {
      this.connection.onaddstream = function(media) { fn(media.stream) };
    },

    agree: function(answer) {
      var remoteSession = new RTCSessionDescription(answer);
      this.connection.setRemoteDescription(remoteSession);
    },

    accept: function(offer) {
      var connection = this.connection;
      var remoteSession = new RTCSessionDescription(offer);
      var defer = Q.defer();

      connection.setRemoteDescription(remoteSession);
      connection.createAnswer(function(sessionDescription) {
        connection.setLocalDescription(sessionDescription);
        defer.resolve(sessionDescription);
      }, null, constrains);

      return defer.promise;
    },

    candidates: function(fn) { this.outgoingCandidates.subscribe = fn; },

    ready: function() {
      this.incomingCandidates.subscribe = Function.prototype.bind.apply(function(candidateObject) {
        this.addIceCandidate(candidateObject);
      }, [this.connection]);
    },

    addCandidate: function(data) {
      if(data.candidate) {
        var candidate = {
          label: data.sdpMLineIndex,
          id: data.sdpMid,
          candidate: data.candidate
        }

        var candidateObject = new RTCIceCandidate(candidate);
        this.incomingCandidates.push(candidateObject);
      }
    }
  };

  Anchorman.Camera = function(connection) {
    this.connection = connection;
    this.stream = null;
  };

  Anchorman.Camera.prototype = {
    ready: function(fn) {
      var connection = this.connection;
      var camera = this;
      var defer = Q.defer();

      navigator.getUserMedia({ video: true, audio: true }, function(stream) {
        connection.connection.addStream(stream);

        camera.stream = stream;
        defer.resolve(stream);
      }, function(error) { defer.reject(error) });

      defer.promise.then(fn);
    }
  };

  Anchorman.prototype = {
    get camera() {
      if(!this._camera) this._camera = new Anchorman.Camera(this.connection);
      return this._camera;
    },

    get connection() {
      if(!this._connection) this._connection = new Anchorman.Connection;
      return this._connection;
    }
  };

  window.Anchorman = Anchorman;
})();
