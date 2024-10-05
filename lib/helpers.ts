import {JSONSerializer, CBORSerializer, MsgPackSerializer, Serializer, Error as ErrorMsg} from "wampproto";

const jsonSubProtocol = "wamp.2.json";
const cborSubProtocol = "wamp.2.cbor";
const msgpackSubProtocol = "wamp.2.msgpack";


export function getSubProtocol(serializer: Serializer): string {
    if (serializer instanceof JSONSerializer) {
        return jsonSubProtocol;
    } else if (serializer instanceof CBORSerializer) {
        return cborSubProtocol;
    } else if (serializer instanceof MsgPackSerializer) {
        return msgpackSubProtocol;
    } else {
        throw new Error("invalid serializer");
    }
}

export function wampErrorString(err: ErrorMsg): string {
    let errStr = err.uri;
    if (err.args && err.args.length > 0) {
        const args = err.args.map((arg: any) => arg.toString()).join(", ");
        errStr += `: ${args}`;
    }
    if (err.kwargs && Object.keys(err.kwargs).length > 0) {
        const kwargs = Object.entries(err.kwargs)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ");
        errStr += `: ${kwargs}`;
    }
    return errStr;
}
