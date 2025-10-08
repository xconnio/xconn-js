import {connectAnonymous, Event} from "../../lib";

async function main() {
    const testTopic = "io.xconn.test";

    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");

    const onEvent = (event: Event) => {
        console.log(`Received Event: args=${event.args}, kwargs=${event.kwargs}, details=${event.details}`);
    };

    const subscription = await session.subscribe(testTopic, onEvent);
    console.log(`Subscribed to topic: ${testTopic}`);

    // Handle SIGINT (Ctrl+C) to cleanup
    process.on("SIGINT", async () => {
        console.log("SIGINT received. Cleaning up...");
        await subscription.unsubscribe();
        await session.close();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("Error:", err);
});
