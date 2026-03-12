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

    getSessionDetails(): SessionDetails {
        throw new Error("UnimplementedError");
    }
}

export class BaseSession extends IBaseSession {
    private readonly _peer: Peer;
    private readonly _serializer: Serializer;
    private readonly _sessionDetails: SessionDetails;

    private _disconnectCallbacks: Array<(reason?: string) => Promise<void>> = [];

    constructor(peer: Peer, sessionDetails: SessionDetails, serializer: Serializer) {
        super();
        this._peer = peer;
        this._serializer = serializer;
        this._sessionDetails = sessionDetails;

        if (peer.onDisconnect) {
            peer.onDisconnect(async () => {
                if (this._disconnectCallbacks.length > 0) {
                    await Promise.all(this._disconnectCallbacks.map(cb => cb()));
                }
            });
        }
    }

    id(): number {
        return this._sessionDetails.sessionID;
    }

    realm(): string {
        return this._sessionDetails.realm;
    }

    authid(): string {
        return this._sessionDetails.authid;
    }

    authrole(): string {
        return this._sessionDetails.authrole;
    }

    serializer(): Serializer {
        return this._serializer;
    }

    send(data: any): void {
        this._peer.send(data);
    }

    async receive(): Promise<any> {
        return this._peer.receive();
    }

    sendMessage(msg: Message): void {
        const data: string | Uint8Array = this._serializer.serialize(msg);
        this._peer.send(data);
    }

    async receiveMessage(): Promise<Message> {
        const data = await this._peer.receive();

        return this._serializer.deserialize(data);
    }

    async close(): Promise<void> {
        await this._peer.close();
    }

    isConnected(): boolean {
        return this._peer.isConnected();
    }

    onDisconnect(callback: (reason?: string) => Promise<void>): void {
        this._disconnectCallbacks.push(callback);
    }

    getSessionDetails(): SessionDetails {
        return this._sessionDetails;
    }
}

export class Result {
    args: any[];
    kwargs: { [key: string]: any };
    details: { [key: string]: any };
    progress: boolean;

    constructor(args?: any[], kwargs?: { [key: string]: any }, details?: { [key: string]: any }) {
        this.args = args || [];
        this.kwargs = kwargs || {};
        this.details = details || {};
        this.progress = details?.progress === true;
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
    public sendProgress?: (args?: any[], kwargs?: { [key: string]: any }) => void;

    constructor(
        public readonly args: any[] = [],
        public readonly kwargs: { [key: string]: any } = {},
        public readonly details: { [key: string]: any } = {},
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
    constructor(
        public readonly subscriptionID: number,
        private readonly session: Session,
        public readonly eventHandler: (event: Event) => void
    ) {}

    async unsubscribe(): Promise<void> {
        return this.session.unsubscribe(this);
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

export class ProgressResult {
    private queue: Result[] = [];
    private push: ((res: Result) => void) | null = null;
    private done = false;
    private finalResult: Result | null = null;

    constructor(
        private finalResultPromise: Promise<Result>,
        private registerProgress: (handler: (res: Result) => Promise<void>) => void
    ) {
        // register a handler with the session
        this.registerProgress(async (res) => {
            if (this.done) return;
            if (this.push) this.push(res);
            else this.queue.push(res);
        });

        // when final result arrives
        this.finalResultPromise.then((res) => {
            this.done = true;
            this.finalResult = res;
            if (this.push) this.push(res);
        });
    }

    async* receive(): AsyncGenerator<Result, Result, unknown> {
        while (!this.done || this.queue.length) {
            const next = this.queue.shift() ?? await new Promise<Result>((resolve) => (this.push = resolve));
            yield next;
            this.push = null;
        }

        return this.finalResult!;
    }
}

export class Progress {
    constructor(
        public args: any[] = [],
        public kwargs: { [key: string]: any } = {},
        public options: { [key: string]: any } = {},
    ) {
    }
}

export class SessionClosedError extends Error {}

export interface Peer {
    send(data: Uint8Array | string): void;
    receive(): Promise<Uint8Array | string>;
    close(): Promise<void>;
    isConnected(): boolean;
    onDisconnect?(callback: () => Promise<void>): void;
}

export class WebSocketPeer implements Peer {
    private readonly _ws: WebSocket;
    private _queue: (Uint8Array | string)[] = [];
    private _waiting: {
        resolve: (data: Uint8Array | string) => void,
        reject: (err: Error) => void
    }[] = [];

    private _disconnectHandlers: (() => Promise<void>)[] = [];
    private _closed = false;

    constructor(ws: WebSocket) {
        this._ws = ws;
        this._ws.binaryType = "arraybuffer";
        this._bindEvents();
    }

    private _bindEvents() {
        this._ws.addEventListener("message", (event: MessageEvent) => {
            const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;

            if (this._waiting.length > 0) {
                const waiter = this._waiting.shift()!;
                waiter.resolve(data);
            } else {
                this._queue.push(data);
            }

        });

        this._ws.addEventListener("close", (e) => {
            void this._handleDisconnect();
        });

        this._ws.addEventListener("error", (e) => {
            void this._handleDisconnect();
        });
    }

    private async _handleDisconnect() {
        if (this._closed) return;
        this._closed = true;

        while (this._waiting.length > 0) {
            const waiter = this._waiting.shift();
            waiter?.reject(new Error("WebSocket closed"));
        }

        for (const cb of this._disconnectHandlers) {
            await cb();
        }
    }

    onDisconnect(callback: () => Promise<void>): void {
        this._disconnectHandlers.push(callback);
    }

    isConnected(): boolean {
        return this._ws.readyState === WebSocket.OPEN;
    }

    send(data: Uint8Array | string): void {
        this._ws.send(data);
    }

    async receive(): Promise<Uint8Array | string> {
        if (this._queue.length > 0) {
            return this._queue.shift()!;
        }

        return new Promise((resolve, reject) => {
            this._waiting.push({ resolve, reject });
        });
    }

    async close(): Promise<void> {
        if (this._closed) return;

        this._closed = true;
        this._ws.close();

        await this._handleDisconnect();
    }
}
