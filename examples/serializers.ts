import {Client, JSONSerializer, CBORSerializer, MsgPackSerializer, Session} from "../lib";


async function connectJSON(): Promise<Session> {
    const client = new Client({serializer: new JSONSerializer()});
    return await client.connect("ws://localhost:8080/ws", "realm1");
}

async function connectCBOR(): Promise<Session> {
    const client = new Client({serializer: new CBORSerializer()});
    return await client.connect("ws://localhost:8080/ws", "realm1");
}

async function connectMsgPack(): Promise<Session> {
    const client = new Client({serializer: new MsgPackSerializer()});
    return await client.connect("ws://localhost:8080/ws", "realm1");
}
