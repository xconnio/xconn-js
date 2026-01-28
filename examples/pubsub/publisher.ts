import {connectAnonymous} from "../../lib";

async function main() {
    const testTopic = "io.xconn.test";
    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");

    // publish event to topic
    await session.publish(testTopic);

    // publish event with args
    await session.publish(testTopic, ["Hello", "World"]);

    // publish event with kwargs
    await session.publish(testTopic, [], {"key": "value"});

    // publish event with options
    await session.publish(testTopic,[], {}, {"acknowledge": true});

    // publish event with args & kwargs
    await session.publish(testTopic, ["Hello", "World"], {"key": "value"});

    // publish event with args, kwargs & options
    await session.publish(testTopic, ["Hello", "World"], {"key": "value"}, {"acknowledge": true});

    console.log(`Published events to ${testTopic}`);

    await session.leave();
}

main().catch((err) => {
    console.error("Error:", err);
});
