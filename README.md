# xconn
A JavaScript WAMP client library built for both browser and Node.js environments.

## Installation

To install `xconn`, add the following in your `package.json` file:

### Install from github

```javascript
"dependencies": {
    "xconn": "github:xconnio/xconn-js#13fbafb2c8e1e30a1cf13803fd207f5705270e24"
}
```

## Client

Creating a client:

```javascript
import {connectAnonymous} from "xconn";


async function main() {
    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");
}
```

Once the session is established, you can perform WAMP actions. Below are examples of all 4 WAMP
operations:

### Subscribe to a topic

```javascript
import {Event, Session} from "xconn";


async function eventHandler(event: Event) {
    console.log(`Received Event: args=${event.args}, kwargs=${event.kwargs}, details=${event.details}`);
}

async function exampleSubscribe(session: Session) {
    await session.subscribe("io.xconn.example", eventHandler);
}
```

### Publish to a topic

```javascript
import {Session} from "xconn";


async function examplePublish(session: Session) {
    await session.publish("io.xconn.example", ["test"], {"key": "value"});
}
```

### Register a procedure

```javascript
import {Session, Invocation, Result} from "xconn";


function echoHandler(invocation: Invocation): Result {
    console.log(`Received Invocation: args=${invocation.args}, kwargs=${invocation.kwargs}, details=${invocation.details}`);
    return new Result(invocation.args, invocation.kwargs, invocation.details);
}

async function echoHandler(session: Session) {
    await session.register("io.xconn.echo", endpoint);
}
```

### Call a procedure

```javascript
import {Session} from "xconn";


async function exampleCall(session: Session) {
    await session.call("io.xconn.echo", [1, 2], {"key": "value"});
}
```

## Authentication

Authentication is straightforward.

### Ticket Auth

```javascript
const session = await connectTicket("ws://localhost:8080/ws", "realm1", "authid", "ticket");
```

### Challenge Response Auth

```javascript
const session = await connectCRA("ws://localhost:8080/ws", "realm1", "authid", "secret");
```

### Cryptosign Auth

```javascript
const session = await connectCryptosign("ws://localhost:8080/ws", "realm1", "authid", "150085398329d255ad69e82bf47ced397bcec5b8fbeecd28a80edbbd85b49081");
```

For more detailed examples or usage, refer to the sample [example](examples) of the project.
