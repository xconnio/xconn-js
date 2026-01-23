import {connectAnonymous, Invocation, Result} from "../../lib";

const procedureDownload = "io.xconn.progress.download";

async function main() {
    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");

    // Handler for "io.xconn.progress.download"
    const downloadHandler = async (inv: Invocation): Promise<Result> => {
        const fileSize = 100; // Simulate a file size of 100 units

        for (let i = 0; i <= fileSize; i += 10) {
            const progress = Math.floor((i * 100) / fileSize); // percentage

            // Send progressive result
            inv.sendProgress?.([progress]);

            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        return new Result(["Download complete!"]);
    };

    const registration = await session.register(procedureDownload, downloadHandler);

    console.log(`Registered procedure ${procedureDownload} successfully`);

    // Handle SIGINT (Ctrl+C)
    process.on("SIGINT", async () => {
        console.log("SIGINT received. Cleaning up...");
        await registration.unregister();
        await session.leave();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("Error:", err);
});
