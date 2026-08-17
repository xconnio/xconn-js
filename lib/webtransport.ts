import {
    AnonymousAuthenticator,
    CBORSerializer,
    ClientAuthenticator,
    CryptoSignAuthenticator,
    WAMPCRAAuthenticator,
} from 'wampproto';

import {DisconnectHandlers, IBaseSession, Peer} from './types';
import {joinPeer} from './joiner';
import {Session} from './session';

// RawSocket framing constants.
const RAWSOCKET_MAGIC = 0x7f;
const SERIALIZER_CBOR = 3;
// RawSocket frame length is a 3-byte field, so no frame can ever exceed this regardless
// of what either side declares during the handshake.
const FRAME_LENGTH_LIMIT = 0xffffff;
// The handshake's Lexp field is a 4-bit power-of-2 exponent (accept up to 2^(9+Lexp)), not
// a literal byte count. 15 is its largest representable value, declaring willingness to
// accept anything up to FRAME_LENGTH_LIMIT above — the true wire-format ceiling, rather
// than settling for 1<<23 = 8MB, the largest *power of 2* that fits under it.
const CLIENT_MAX_MSG_LEXP = 15;
const HANDSHAKE_BYTE1 = (CLIENT_MAX_MSG_LEXP << 4) | SERIALIZER_CBOR;

const MSG_WAMP = 0;
const MSG_PING = 1;
const MSG_PONG = 2;

function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
}

// readAtLeast reads from reader, appending to buf, until buf holds at least n bytes.
async function readAtLeast(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    buf: Uint8Array<ArrayBuffer>,
    n: number,
): Promise<Uint8Array<ArrayBuffer>> {
    while (buf.length < n) {
        const {value, done} = await reader.read();
        if (done) throw new Error('WebTransport stream closed');
        buf = concatBytes(buf, value);
    }
    return buf;
}

export class WebTransportPeer implements Peer {
    private _buffer: Uint8Array<ArrayBuffer>;
    private readonly _disconnect = new DisconnectHandlers();

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

    // _handleDisconnect fires disconnect handlers, whether triggered by an explicit
    // close(), a read/write failure, or the stream closing from the other end — always
    // via the same cleanup path so the writer/reader are released exactly once either way.
    private async _handleDisconnect(): Promise<void> {
        await this._disconnect.fire(async () => {
            try {
                await this._writer.close();
            } catch (_) { /* ignore */
            }
            try {
                await this._reader.cancel();
            } catch (_) { /* ignore */
            }
        });
    }

    private async _readBytes(n: number): Promise<Uint8Array<ArrayBuffer>> {
        this._buffer = await readAtLeast(this._reader, this._buffer, n);
        const result = this._buffer.slice(0, n);
        this._buffer = this._buffer.subarray(n) as Uint8Array<ArrayBuffer>;
        return result;
    }

    async receive(): Promise<Uint8Array> {
        try {
            const header = await this._readBytes(4);
            const msgType = header[0];
            // A 3-byte big-endian value, so this can never exceed FRAME_LENGTH_LIMIT —
            // no separate bounds check needed now that Lexp=15 declares the full range.
            const length = (header[1] << 16) | (header[2] << 8) | header[3];

            const payload = length > 0 ? await this._readBytes(length) : new Uint8Array(0);

            if (msgType === MSG_WAMP) return payload;
            if (msgType === MSG_PING) {
                await this._writeFrame(MSG_PONG, payload);
                return this.receive();
            }
            if (msgType === MSG_PONG) return this.receive();
            throw new Error(`unknown rawsocket message type: ${msgType}`);
        } catch (e) {
            await this._handleDisconnect();
            throw e;
        }
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
        await this._handleDisconnect();
    }

    isConnected(): boolean {
        return !this._disconnect.fired;
    }

    onDisconnect(callback: () => Promise<void>): void {
        this._disconnect.add(callback);
    }
}

export interface WebTransportCertHash {
    algorithm: string;
    value: BufferSource;
}

// WebTransportSession wraps a Session and exposes the underlying WebTransport connection
// for opening additional WAMP sessions and raw bidirectional streams on the same connection.
export class WebTransportSession extends Session {
    constructor(
        base: IBaseSession,
        private readonly _wt: WebTransport,
        private readonly _ownsConnection: boolean = true,
    ) {
        super(base);
    }

    // connection returns the underlying WebTransport object.
    connection(): WebTransport {
        return this._wt;
    }

    // leave sends a WAMP Goodbye on this session's stream. If this session owns the
    // connection (i.e. it was created by connectWebTransport*, not by openSession()),
    // it also shuts down the entire WebTransport connection, even if the Goodbye fails.
    async leave(): Promise<void> {
        try {
            await super.leave();
        } finally {
            if (this._ownsConnection) this._wt.close();
        }
    }

    // openSession opens an additional WAMP session on the same WebTransport connection.
    // Each call opens a new stream and performs a fresh WAMP Hello/Welcome exchange.
    // The returned session does not own the connection: its leave() only ends its own
    // stream, leaving the connection open for the rest of its sessions.
    async openSession(realm: string, authenticator?: ClientAuthenticator): Promise<WebTransportSession> {
        return createWebTransportSession(this._wt, realm, authenticator, false);
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

        const buf = await readAtLeast(reader, new Uint8Array(0), 4);
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

        // Decode the server-negotiated max message size from the high nibble, clamped to what
        // the 3-byte RawSocket frame length field can encode (a raw Lexp=15 shift overflows it).
        const maxMsgSize = Math.min(1 << (9 + (header[1] >> 4)), FRAME_LENGTH_LIMIT);

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
    ownsConnection = true,
): Promise<WebTransportSession> {
    const peer = await openStreamPeer(wt);
    try {
        const base = await joinPeer(peer, realm, new CBORSerializer(), authenticator);
        return new WebTransportSession(base, wt, ownsConnection);
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

async function connect(
    url: string,
    realm: string,
    authenticator: ClientAuthenticator | undefined,
    certHashes: WebTransportCertHash[] | undefined,
): Promise<WebTransportSession> {
    const wt = await openWebTransport(url, certHashes);
    try {
        return await createWebTransportSession(wt, realm, authenticator);
    } catch (e) {
        wt.close();
        throw e;
    }
}

export async function connectWebTransport(
    url: string,
    realm: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    return connect(url, realm, undefined, certHashes);
}

export async function connectWebTransportAnonymous(
    url: string,
    realm: string,
    authid: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    return connect(url, realm, new AnonymousAuthenticator(authid, {}), certHashes);
}

export async function connectWebTransportCRA(
    url: string,
    realm: string,
    authid: string,
    secret: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    return connect(url, realm, new WAMPCRAAuthenticator(authid, secret, null), certHashes);
}

export async function connectWebTransportCryptosign(
    url: string,
    realm: string,
    authid: string,
    privateKey: string,
    certHashes?: WebTransportCertHash[],
): Promise<WebTransportSession> {
    return connect(url, realm, new CryptoSignAuthenticator(authid, privateKey, {}), certHashes);
}
