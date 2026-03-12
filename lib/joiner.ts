import {Joiner, ClientAuthenticator, Serializer, JSONSerializer} from 'wampproto';

import {BaseSession, Peer, WebSocketPeer} from './types';
import {getSubProtocol} from './helpers';


async function ensureGlobalWebSocket() {
    if (typeof globalThis.WebSocket === 'undefined') {
        const ws = await import('ws');
        globalThis.WebSocket = ws.default;
    }
}

export class WAMPSessionJoiner {
    private readonly _authenticator?: ClientAuthenticator;
    private readonly _serializer: Serializer;

    constructor(joinerOptions: { authenticator?: ClientAuthenticator, serializer?: Serializer }) {
        this._serializer = joinerOptions.serializer || new JSONSerializer();
        this._authenticator = joinerOptions.authenticator;
    }

    async join(uri: string, realm: string): Promise<BaseSession> {
        await ensureGlobalWebSocket();
        const ws = new WebSocket(uri, [getSubProtocol(this._serializer)]);
        await new Promise((resolve, reject) => {
            ws.addEventListener("open", resolve);
            ws.addEventListener("error", reject);
        });

        const peer = new WebSocketPeer(ws);

        return joinPeer(peer, realm, this._serializer, this._authenticator);
    }
}


export async function joinPeer(
    peer: Peer,
    realm: string,
    serializer: Serializer,
    authenticator?: ClientAuthenticator
): Promise<BaseSession> {
    const joiner = new Joiner(realm, serializer, authenticator);
    const hello = joiner.sendHello();
    peer.send(hello);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const msgBytes = await peer.receive();

        const toSend = await joiner.receive(msgBytes);

        if (toSend === null) {
            return new BaseSession(
                peer,
                joiner.getSessionDetails(),
                serializer
            );
        }

        peer.send(toSend);
    }
}
