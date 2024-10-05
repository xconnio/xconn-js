import {Serializer, Message, SessionDetails} from "wampproto";


export abstract class IBaseSession {
    id(): number {
        throw new Error("UnimplementedError");
    }

    realm(): string {
        throw new Error("UnimplementedError");
    }

    authid(): string {
        throw new Error("UnimplementedError");
    }

    authrole(): string {
        throw new Error("UnimplementedError");
    }

    serializer(): Serializer {
        throw new Error("UnimplementedError");
    }

    send(data: any): void {
        throw new Error("UnimplementedError");
    }

    async receive(): Promise<any> {
        throw new Error("UnimplementedError");
    }

    sendMessage(msg: Message): void {
        throw new Error("UnimplementedError");
    }

    async receiveMessage(): Promise<Message> {
        throw new Error("UnimplementedError");
    }

    async close(): Promise<void> {
        throw new Error("UnimplementedError");
    }
}

export class BaseSession extends IBaseSession {
    private readonly _ws: WebSocket;
    private readonly _wsMessageHandler: any;
    private readonly sessionDetails: SessionDetails;
    private readonly _serializer: Serializer;

    constructor(
        ws: WebSocket,
        wsMessageHandler: any,
        sessionDetails: SessionDetails,
        serializer: Serializer
    ) {
        super();
        this._ws = ws;
        this._wsMessageHandler = wsMessageHandler;
        this.sessionDetails = sessionDetails;
        this._serializer = serializer;

        // close cleanly on abrupt client disconnect
        this._ws.addEventListener("close", async () => {
            await this.close();
        });
    }

    id(): number {
        return this.sessionDetails.sessionID;
    }

    realm(): string {
        return this.sessionDetails.realm;
    }

    authid(): string {
        return this.sessionDetails.authid;
    }

    authrole(): string {
        return this.sessionDetails.authrole;
    }

    serializer(): Serializer {
        return this._serializer;
    }

    send(data: any): void {
        this._ws.send(data);
    }

    sendMessage(msg: Message): void {
        this.send(this._serializer.serialize(msg));
    }

    async receive(): Promise<any> {
        return new Promise((resolve) => {
            const messageHandler = (event: MessageEvent) => {
                resolve(event.data);
                this._ws.removeEventListener("message", messageHandler);
            };

            this._ws.addEventListener("message", messageHandler, {once: true});
        });
    }

    async receiveMessage(): Promise<Message> {
        return this._serializer.deserialize(await this.receive());
    }

    async close(): Promise<void> {
        if (this._wsMessageHandler) {
            this._ws.removeEventListener("message", this._wsMessageHandler);
            this._ws.removeEventListener("close", this._wsMessageHandler);
        }

        this._ws.close();
    }
}
