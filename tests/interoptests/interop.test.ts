import {
    CBORSerializer,
    CryptoSignAuthenticator,
    JSONSerializer,
    MsgPackSerializer,
    WAMPCRAAuthenticator,
    AnonymousAuthenticator,
    TicketAuthenticator,
    Event
} from "wampproto";
import {Client} from "../../lib";
import {Invocation, Result} from "../../lib";

const XCONN_URL = "ws://127.0.0.1:8080/ws";
const CROSSBAR_URL = "ws://127.0.0.1:8081/ws";
const REALM = "realm1";
const PROCEDURE_ADD = "io.xconn.backend.add2";

const ROUTER_URLS = [
    XCONN_URL,
    CROSSBAR_URL
];

const SERIALIZERS = [
    new JSONSerializer(),
    new CBORSerializer(),
    new MsgPackSerializer(),
];
const AUTHENTICATORS = [
    new AnonymousAuthenticator("", {}),
    new TicketAuthenticator("ticket-user","ticket-pass", {}),
    new WAMPCRAAuthenticator("wamp-cra-user", "cra-secret", {}),
    new WAMPCRAAuthenticator("wamp-cra-salt-user", "cra-salt-secret", {}),
    new CryptoSignAuthenticator(
        "cryptosign-user",
        "150085398329d255ad69e82bf47ced397bcec5b8fbeecd28a80edbbd85b49081",
        {}
    ),
];

describe("WAMP Tests", function () {
    ROUTER_URLS.forEach((url) => {
        SERIALIZERS.forEach((serializer) => {
            AUTHENTICATORS.forEach((authenticator) => {
                it(`Call with url: ${url}, serializer: ${serializer.constructor.name}, authenticator: ${authenticator.constructor.name}`, async function () {
                    const client = new Client({authenticator, serializer});
                    const session = await client.connect(url, REALM);

                    const result = await session.call(PROCEDURE_ADD, [2, 2]);
                    expect(result.args[0]).toBe(4);

                    await session.close();
                });

                it(`PubSub with url: ${url}, serializer: ${serializer.constructor.name}, authenticator: ${authenticator.constructor.name}`, async function () {
                    const client = new Client({authenticator, serializer});
                    const args = ["hello", "wamp"];

                    const eventHandler = (event: Event) => {
                        expect(event.args).toEqual(args);
                    };

                    const subscriber = await client.connect(url, REALM);
                    await subscriber.subscribe("io.xconn.test", eventHandler);

                    const publisher = await client.connect(url, REALM);
                    await publisher.publish("io.xconn.test", {args: args, options: {"acknowledge": true}});

                    await subscriber.close();
                    await publisher.close();
                });

                it(`RPC with url: ${url}, serializer: ${serializer.constructor.name}, authenticator: ${authenticator.constructor.name}`, async function () {
                    const client = new Client({authenticator, serializer});
                    const args = ["hello", "wamp"];

                    const invHandler = (inv: Invocation) => {
                        return new Result(inv.args, inv.kwargs, inv.details);
                    };

                    const callee = await client.connect(url, REALM);
                    await callee.register("io.xconn.test", invHandler);

                    const caller = await client.connect(url, REALM);
                    const result = await caller.call("io.xconn.test", args);
                    expect(result.args).toEqual(args);

                    await callee.close();
                    await caller.close();
                });
            });
        });
    });
});
