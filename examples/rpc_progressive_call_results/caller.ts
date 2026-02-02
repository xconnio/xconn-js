import { connectAnonymous, Result } from "../../lib";

const procedureDownload = "io.xconn.progress.download";

async function main() {
    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");

    console.log(`Calling procedure ${procedureDownload} with progress...`);

    const progressCall = await session.callProgress("io.xconn.progress.download");

    for await (const res of progressCall.receive()) {
        console.log(res.args[0]); // prints progress updates and final result
    }

    await session.leave();
    process.exit(0);
}

main().catch((err) => {
    console.error("Error:", err);
});
