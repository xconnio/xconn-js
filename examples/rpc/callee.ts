import {connectAnonymous, Invocation, Result} from "../../lib";

async function main() {
    const testProcedureEcho = "io.xconn.echo";
    const testProcedureAsyncEcho = "io.xconn.async.echo";
    const testProcedureSum = "io.xconn.sum";

    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");

    // Handler for "io.xconn.echo"
    const echo = (inv: Invocation): Result => {
        console.log(`Received args=${inv.args}, kwargs=${inv.kwargs}`);
        return new Result(inv.args, inv.kwargs);
    };

    // Handler for "io.xconn.async.echo"
    const echoAsyncHandler = async (inv: Invocation): Promise<Result> => {
        console.log(`Received args=${inv.args}, kwargs=${inv.kwargs}`);
        return new Result(inv.args, inv.kwargs);
    };

    // Handler for "io.xconn.sum"
    const sumHandler = (inv: Invocation): Result => {
        console.log(`Received args=${inv.args}, kwargs=${inv.kwargs}`);
        const total = (inv.args ?? []).reduce((acc: number, val: number) => acc + val, 0);
        return new Result([total]);
    };

    const echoRegistration = await session.register(testProcedureEcho, echo);
    console.log(`Registered procedure '${testProcedureEcho}'`);

    const echoAsyncRegistration = await session.register(testProcedureAsyncEcho, echoAsyncHandler);
    console.log(`Registered procedure '${testProcedureAsyncEcho}'`);

    const sumRegistration = await session.register(testProcedureSum, sumHandler);
    console.log(`Registered procedure '${testProcedureSum}'`);

    // Handle SIGINT (Ctrl+C)
    process.on("SIGINT", async () => {
        console.log("SIGINT received. Cleaning up...");

        await echoRegistration.unregister();
        await echoAsyncRegistration.unregister();
        await sumRegistration.unregister();
        await session.leave();

        process.exit(0);
    });
}

main().catch((err) => {
    console.error("Error:", err);
});
