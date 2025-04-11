import {
    JSONSerializer,
    CBORSerializer,
    MsgPackSerializer,
    Serializer,
    Error as ErrorMsg,
    Register,
    Message, Hello, HelloFields, ErrorFields
} from "wampproto";
import {getSubProtocol, wampErrorString} from "./helpers";


class TestSerializer implements Serializer {
    serialize(_msg: Message): Uint8Array {
        return new TextEncoder().encode("");
    }

    deserialize(_data: any): Message {
        return new Hello(new HelloFields("realm", {}, "", []));
    }
}

describe("getSubProtocol", () => {
    it("with JSONSerializer", () => {
        expect(getSubProtocol(new JSONSerializer())).toBe("wamp.2.json");
    });

    it("with CBORSerializer", () => {
        expect(getSubProtocol(new CBORSerializer())).toBe("wamp.2.cbor");
    });

    it("with MsgPackSerializer", () => {
        expect(getSubProtocol(new MsgPackSerializer())).toBe("wamp.2.msgpack");
    });

    it("with invalid serializer", () => {
        expect(() => getSubProtocol(new TestSerializer())).toThrow("invalid serializer");
    });
});

describe("wampErrorString", () => {
    it("no args or kwargs", () => {
        const err = new ErrorMsg(new ErrorFields(Register.TYPE, 1, "wamp.error.no_such_procedure"));
        expect(wampErrorString(err)).toBe("wamp.error.no_such_procedure");
    });

    it("with args only", () => {
        const err = new ErrorMsg(new ErrorFields(Register.TYPE, 1, "wamp.error.no_such_procedure", [1, "two"]));
        expect(wampErrorString(err)).toBe("wamp.error.no_such_procedure: 1, two");
    });

    it("with kwargs only", () => {
        const err = new ErrorMsg(new ErrorFields(Register.TYPE, 1, "wamp.error.no_such_procedure", [], {key: "value"}));
        expect(wampErrorString(err)).toBe("wamp.error.no_such_procedure: key=value");
    });

    it("with args and kwargs", () => {
        const err = new ErrorMsg(new ErrorFields(Register.TYPE, 1, "wamp.error.no_such_procedure", [1, "two"], {key: "value"}));
        expect(wampErrorString(err)).toBe("wamp.error.no_such_procedure: 1, two: key=value");
    });
});
