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

    this.config = {
      defaultEvents: {
        iceCandidate: "anchorman:icecandidate",
        offer:        "anchorman:offer",
        answer:       "anchorman:answer"
      },

      connectionOptions: {
        "iceServers": [ { "url": "stun:stun.l.google.com:19302" } ]
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
    this.socket = new RTCPeerConnection(null);
    this.anchorman = anchorman;
    this.transport = anchorman.transport;

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

    this.socket.onnegotiationneeded = function() {
      console.log("negotiation needed");
    }
  };

  Anchorman.Connection.prototype = {
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

  Anchorman.Camera = function(connection) {
    this.connection = connection;
  };

  Anchorman.Camera.prototype = {
    receive: function(fn) {
      this.connection.receiveStream(fn);
    },

    broadcast: function(fn) {
      var defer = Q.defer();

      navigator.getUserMedia({ video: true, audio: true }, Anchorman.Util.bind(function(stream) {
        this.connection.addStream(stream);
        this.connection.offer();

        defer.resolve(stream);
      }, this), function(error) { defer.reject(error) });

      defer.promise.then(fn);
    },
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

    get camera() {
      if(!this._camera) this._camera = new Anchorman.Camera(this.connection);
      return this._camera;
    }
  };

  window.Anchorman = Anchorman;
})();
