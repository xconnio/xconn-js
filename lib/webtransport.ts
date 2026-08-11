import {
    AnonymousAuthenticator,
    CBORSerializer,
    ClientAuthenticator,
    CryptoSignAuthenticator,
    WAMPCRAAuthenticator,
} from 'wampproto';

import {IBaseSession, Peer} from './types';
import {joinPeer} from './joiner';
import {Session} from './session';

// RawSocket framing constants.
const RAWSOCKET_MAGIC = 0x7f;
const SERIALIZER_CBOR = 3;
// DefaultMaxMsgSize = 1<<20 (1MB), log2=20 → byte1 = ((20-9)<<4) | SERIALIZER_CBOR = 0xB3
const HANDSHAKE_BYTE1 = ((20 - 9) << 4) | SERIALIZER_CBOR;

const MSG_WAMP = 0;
const MSG_PING = 1;
const MSG_PONG = 2;

function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

export class WebTransportPeer implements Peer {
    private _buffer: Uint8Array<ArrayBuffer>;
    private _connected = true;
    private _disconnectHandlers: (() => Promise<void>)[] = [];

    constructor(
        private readonly _writer: WritableStreamDefaultWriter<Uint8Array>,
        private readonly _reader: ReadableStreamDefaultReader<Uint8Array>,
        initialBuffer: Uint8Array<ArrayBuffer>,
        private readonly _maxMsgSize: number,
    ) {
        this._buffer = initialBuffer;
        // Stream-level closure handles both per-stream close and WT connection close.
        this._reader.closed
            .then(() => this._handleDisconnect())
            .catch(() => this._handleDisconnect());
    }

    private async _runDisconnectHandlers(): Promise<void> {
        for (const cb of this._disconnectHandlers) {
            await cb();
        }
    }

    private async _handleDisconnect(): Promise<void> {
        if (!this._connected) return;
        this._connected = false; // synchronous guard before first await
        await this._runDisconnectHandlers();
    }

    private async _readBytes(n: number): Promise<Uint8Array<ArrayBuffer>> {
        while (this._buffer.length < n) {
            const {value, done} = await this._reader.read();
            if (done) throw new Error('WebTransport stream closed');
            this._buffer = concatBytes(this._buffer, value);
        }
        const result = this._buffer.slice(0, n);
        this._buffer = this._buffer.slice(n);
        return result;
    }

    async receive(): Promise<Uint8Array> {
        const header = await this._readBytes(4);
        const msgType = header[0];
        const length = (header[1] << 16) | (header[2] << 8) | header[3];

        if (length > this._maxMsgSize) {
            throw new Error(`inbound frame too large: ${length} bytes (max ${this._maxMsgSize})`);
        }

        const payload = length > 0 ? await this._readBytes(length) : new Uint8Array(0);

        if (msgType === MSG_WAMP) return payload;
        if (msgType === MSG_PING) {
            await this._writeFrame(MSG_PONG, payload);
            return this.receive();
        }
        if (msgType === MSG_PONG) return this.receive();
        throw new Error(`unknown rawsocket message type: ${msgType}`);
    }

    send(data: Uint8Array | string): void {
        if (typeof data === 'string') throw new Error('WebTransportPeer requires binary data');
        if (data.length > this._maxMsgSize) throw new Error(`message too large: ${data.length} bytes (max ${this._maxMsgSize})`);
        this._writeFrame(MSG_WAMP, data).catch(() => {
            void this._handleDisconnect();
        });
    }

    private async _writeFrame(msgType: number, data: Uint8Array): Promise<void> {
        const frame = new Uint8Array(4 + data.length);
        frame[0] = msgType;
        frame[1] = (data.length >> 16) & 0xff;
        frame[2] = (data.length >> 8) & 0xff;
        frame[3] = data.length & 0xff;
        frame.set(data, 4);
        await this._writer.write(frame);
    }

    // close closes only this stream — the underlying WebTransport connection stays open.
    async close(): Promise<void> {
        if (!this._connected) return;
        this._connected = false; // synchronous guard before first await, prevents double-close races
        try {
            await this._writer.close();
        } catch (_) { /* ignore */
        }
        try {
            await this._reader.cancel();
        } catch (_) { /* ignore */
        }
        await this._runDisconnectHandlers();
    }

    isConnected(): boolean {
        return this._connected;
    }

    onDisconnect(callback: () => Promise<void>): void {
        this._disconnectHandlers.push(callback);
    }
}

export interface WebTransportCertHash {
    algorithm: string;
    value: BufferSource;
}

// WebTransportSession wraps a Session and exposes the underlying WebTransport connection
// for opening additional WAMP sessions and raw bidirectional streams on the same connection.
export class WebTransportSession extends Session {
    constructor(base: IBaseSession, private readonly _wt: WebTransport) {
        super(base);
    }

    // connection returns the underlying WebTransport object.
    connection(): WebTransport {
        return this._wt;
    }

    // close sends a WAMP Goodbye and then shuts down the entire WebTransport connection.
    // Use this when the session owns the connection (i.e. it was created by connectWebTransport*).
    // For sessions opened via openSession() use leave() instead.
    async close(): Promise<void> {
        await this.leave();
        this._wt.close();
    }

    // openSession opens an additional WAMP session on the same WebTransport connection.
    // Each call opens a new stream and performs a fresh WAMP Hello/Welcome exchange.
    async openSession(realm: string, authenticator?: ClientAuthenticator): Promise<WebTransportSession> {
        return createWebTransportSession(this._wt, realm, authenticator);
    }

    // openStream opens a raw (non-WAMP) bidirectional stream on the WebTransport connection.
    async openStream(): Promise<WebTransportBidirectionalStream> {
        return this._wt.createBidirectionalStream();
    }
}

// openStreamPeer opens one WebTransport stream, performs the RawSocket handshake,
// and returns a peer ready for WAMP message exchange.
async function openStreamPeer(wt: WebTransport): Promise<WebTransportPeer> {
    const stream = await wt.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    try {
        await writer.write(new Uint8Array([RAWSOCKET_MAGIC, HANDSHAKE_BYTE1, 0x00, 0x00]));

        let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
        while (buf.length < 4) {
            const {value, done} = await reader.read();
            if (done) throw new Error('stream closed during WebTransport handshake');
            buf = concatBytes(buf, value);
        }
        const header = buf.slice(0, 4);
        const remainder = buf.slice(4);

        if (header[0] !== RAWSOCKET_MAGIC) {
            throw new Error(`invalid handshake response: expected 0x${RAWSOCKET_MAGIC.toString(16)}, got 0x${header[0].toString(16)}`);
        }
        // Low nibble 0 means no serializer agreed → server sent an error; error code is in the high nibble.
        if ((header[1] & 0x0F) === 0) {
            const code = header[1] >> 4;
            const msgs: Record<number, string> = {
                1: 'serializer unsupported',
                2: 'maximum message length unacceptable',
                3: 'reserved bits (unsupported feature)',
                4: 'maximum connection count reached',
            };
            throw new Error(`WebTransport handshake rejected: ${msgs[code] ?? `error code ${code}`}`);
        }
        if ((header[1] & 0x0F) !== SERIALIZER_CBOR) {
            throw new Error(`handshake: server selected serializer ${header[1] & 0x0F}, expected CBOR (${SERIALIZER_CBOR})`);
        }

        // Decode the server-negotiated max message size from the high nibble.
        const maxMsgSize = 1 << (9 + (header[1] >> 4));

        return new WebTransportPeer(writer, reader, remainder, maxMsgSize);
    } catch (e) {
        try {
            await writer.close();
        } catch (_) { /* ignore */
        }
        try {
            await reader.cancel();
        } catch (_) { /* ignore */
        }
        throw e;
    }
}

// createWebTransportSession opens a WAMP stream on an existing WebTransport connection,
// performs the RawSocket handshake, and joins the given realm.
async function createWebTransportSession(
    wt: WebTransport,
    realm: string,
    authenticator?: ClientAuthenticator,
): Promise<WebTransportSession> {
    const peer = await openStreamPeer(wt);
    try {
        const base = await joinPeer(peer, realm, new CBORSerializer(), authenticator);
        return new WebTransportSession(base, wt);
    } catch (e) {
        await peer.close().catch(() => {
        });
        throw e;
    }
}

// openWebTransport establishes the WebTransport connection to url.
async function openWebTransport(url: string, certHashes?: WebTransportCertHash[]): Promise<WebTransport> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wt = new WebTransport(url, certHashes?.length ? ({
        allowPooling: false,
        serverCertificateHashes: certHashes
    } as any) : undefined);
    await wt.ready;
    return wt;
}

export async function connectWebTransport(
    url: string,
    realm: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    const wt = await openWebTransport(url, certHashes);
    try {
        return await createWebTransportSession(wt, realm);
    } catch (e) {
        wt.close();
        throw e;
    }
}

export async function connectWebTransportAnonymous(
    url: string,
    realm: string,
    authid: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    const wt = await openWebTransport(url, certHashes);
    try {
        return await createWebTransportSession(wt, realm, new AnonymousAuthenticator(authid, {}));
    } catch (e) {
        wt.close();
        throw e;
    }
}

export async function connectWebTransportCRA(
    url: string,
    realm: string,
    authid: string,
    secret: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    const wt = await openWebTransport(url, certHashes);
    try {
        return await createWebTransportSession(wt, realm, new WAMPCRAAuthenticator(authid, secret, null));
    } catch (e) {
        wt.close();
        throw e;
    }
}

export async function connectWebTransportCryptosign(
    url: string,
    realm: string,
    authid: string,
    privateKey: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    const wt = await openWebTransport(url, certHashes);
    try {
        return await createWebTransportSession(wt, realm, new CryptoSignAuthenticator(authid, privateKey, {}));
    } catch (e) {
        wt.close();
        throw e;
    }
}
