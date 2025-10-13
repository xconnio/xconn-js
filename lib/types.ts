import {Serializer, Message, SessionDetails} from "wampproto";

import {Session} from "./session";
import {ApplicationError} from "./exception";


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

    isConnected(): boolean {
        throw new Error("UnimplementedError");
    }

    onDisconnect(callback: () => Promise<void>): void {
        throw new Error("UnimplementedError");
    }
}

export class BaseSession extends IBaseSession {
    private readonly _ws: WebSocket;
    private readonly _wsMessageHandler: any;
    private readonly sessionDetails: SessionDetails;
    private readonly _serializer: Serializer;
    private _disconnectCallbacks: Array<() => Promise<void>> = [];

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
            if (this._disconnectCallbacks.length > 0) {
                await Promise.all(this._disconnectCallbacks.map(cb => cb()));
            }
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
            const messageHandler = async (event: MessageEvent) => {
                let data = event.data;

                if (event.data instanceof Blob) {
                    data = new Uint8Array(await event.data.arrayBuffer());
                }
                resolve(data);
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

    isConnected(): boolean {
        return this._ws.readyState === WebSocket.OPEN;
    }

    onDisconnect(callback: () => Promise<void>): void {
        this._disconnectCallbacks.push(callback);
    }
}

export class Result {
    args: any[];
    kwargs: { [key: string]: any };
    details: { [key: string]: any };

    constructor(args?: any[], kwargs?: { [key: string]: any }, details?: { [key: string]: any }) {
        this.args = args || [];
        this.kwargs = kwargs || {};
        this.details = details || {};
    }
}

export class Registration {
    constructor(public readonly registrationID: number, private readonly session: Session) {}

    async unregister(): Promise<void> {
        return this.session.unregister(this)
    }
}

export class RegisterRequest {
    constructor(
        public readonly promise: {
            resolve: (value: Registration) => void,
            reject: (reason: ApplicationError) => void
        },
        public readonly endpoint: (invocation: Invocation) => Result | Promise<Result>) {
    }
}

export class Invocation {
    constructor(
        public readonly args: any[] = [],
        public readonly kwargs: { [key: string]: any } = {},
        public readonly details: { [key: string]: any } = {}
    ) {
    }
}

export class UnregisterRequest {
    constructor(
        public readonly promise: { resolve: () => void; reject: (reason: ApplicationError) => void },
        public readonly registrationID: number
    ) {
    }
}

export class Subscription {
    constructor(public readonly subscriptionID: number, private readonly session: Session) {}

    async unsubscribe(): Promise<void> {
        return this.session.unsubscribe(this)
    }
}

export class SubscribeRequest {
    constructor(
        public readonly promise: {
            resolve: (value: Subscription) => void,
            reject: (reason: ApplicationError) => void
        },
        public readonly endpoint: (event: Event) => void
    ) {
    }
}

export class Event {
    constructor(
        public readonly args: any[] = [],
        public readonly kwargs: { [key: string]: any } = {},
        public readonly details: { [key: string]: any } = {}
    ) {
    }
}

export class UnsubscribeRequest {
    constructor(
        public readonly promise: { resolve: () => void; reject: (reason: ApplicationError) => void },
        public readonly subscriptionID: number
    ) {
    }
}
