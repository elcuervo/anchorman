# Anchorman

![](http://www.anchorman-quotes.info/wp-content/uploads/2010/10/Contact-us-anchorman-quotes.jpg)

Dead simple p2p

**PROOF OF CONCEPT, tested in Chrome Canary. More compatibility soon**

## Why is this different from [p2p lib out there]?

Conceptual differences basically.
The transport method (or signaling technique) should be irrelevante IMHO, that's
why there are no hardcoded communication methods. You can overwrite the signals
names if you want to.

## Basic usage

```javascript
var anchorman = new Anchorman("[Choose your schema]");
```

Choose your action:

### Screen sharing

```javascript
// This will try to share the screen based on Chrome screenshare functionality.
// Currently behind `chrome://flags`
anchorman.screen.share();
```

### Camera access

```javascript
// Start the camera without do anything.
anchorman.camera.broadcast();

// Or use the stream as you wish
anchorman.camera.broadcast(function(stream) {
  // Have fun with the stream
});

// Handle a incomming stream
anchorman.camera.receive(function(stream) {
  // Handle incomming
});
```

### Data transfer

```javascript
// Creates a channel or access an already initialized channel
// Returns an actual RTC Channel
var channel = anchorman.channels("chat");

// Accept the message callback
channel.onmessage = function(event) {};

// Initialize the candidate handshake for a given channel
anchorman.data();

// Send a given message
channel.send("bla");
```
