import {connectAnonymous, Result} from "../../lib";

async function main() {
    const testProcedureSum = "io.xconn.sum";
    const testProcedureEcho = "io.xconn.echo";
    const testProcedureAsyncEcho = "io.xconn.async.echo";

    const session = await connectAnonymous("ws://localhost:8080/ws", "realm1");

    // Call procedure "io.xconn.echo" with args and kwargs
    const result: Result = await session.call(testProcedureEcho, ["hello", "world"], {key: "value"});
    console.log(`Result of procedure '${testProcedureEcho}': args=${result.args}, kwargs=${result.kwargs}`);

    // Call with only args
    await session.call(testProcedureEcho, ["hello", "world"]);

    // Call with only kwargs
    await session.call(testProcedureEcho, [], {name: "john"});

    // Call with both args and kwargs
    await session.call(testProcedureEcho, [1, 2], {name: "john"});

    // Call procedure "io.xconn.async.echo" with args and kwargs
    const resultAsync: Result = await session.call(testProcedureAsyncEcho, ["hello", "xconn"], {key: "value"});
    console.log(`Result of procedure '${testProcedureAsyncEcho}': args=${resultAsync.args}, kwargs=${resultAsync.kwargs}`);

    // Call sum procedure and print result
    const sumResult: Result = await session.call(testProcedureSum, [2, 2, 6]);
    console.log(`Sum=${sumResult.args?.[0]}`);

    await session.close();
}

main().catch((err) => {
    console.error("Error:", err);
});
