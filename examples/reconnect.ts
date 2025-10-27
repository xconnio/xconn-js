import { connectAnonymous } from "../lib";

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    let retryDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds

    for (; ;) {
        try {
            const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");
            console.log("Connected successfully");

            // Reset backoff after successful connection
            retryDelay = 1000;

            // Register multiple disconnect callbacks
            session.onDisconnect(async () => {
                console.log("Callback 1: disconnection event.");
            });

            session.onDisconnect(async () => {
                console.log("Callback 2: disconnection event.");
                await sleep(500);
            });

            session.onDisconnect(async () => {
                console.log("Callback 3: disconnection event.");
            });

            // Wait for disconnect
            const disconnected = new Promise<void>(resolve => {
                session.onDisconnect(async () => {
                    console.log("Disconnected from router!");
                    resolve();
                });
            });

            await disconnected;
            console.log("Retrying connection...");

        } catch (err) {
            console.error(`Failed to connect: ${err}`);
            console.log(`Retrying in ${retryDelay / 1000}s...`);
            await sleep(retryDelay);

            // Exponential backoff
            retryDelay = Math.min(retryDelay * 2, maxDelay);
        }
    }
}

main().catch(err => console.error(`Fatal error: ${err}`));
