import {JSONSerializer, CBORSerializer, MsgPackSerializer, Serializer} from "wampproto";

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
