import {Joiner, ClientAuthenticator, Serializer, JSONSerializer} from 'wampproto';

import {BaseSession} from './types';
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
        await ensureGlobalWebSocket()
        const ws = new WebSocket(uri, [getSubProtocol(this._serializer)]);

        const joiner = new Joiner(realm, this._serializer, this._authenticator);

        ws.addEventListener('open', () => {
            ws.send(joiner.sendHello());
        });

        return new Promise<BaseSession>((resolve, reject) => {
            const wsMessageHandler = async (event: MessageEvent) => {
                try {
                    let data = event.data;

                    if (event.data instanceof Blob) {
                        data = new Uint8Array(await event.data.arrayBuffer());
                    }

                    const toSend = await joiner.receive(data);
                    if (!toSend) {
                        ws.removeEventListener('message', wsMessageHandler);
                        ws.removeEventListener('close', closeHandler);

                        const baseSession = new BaseSession(ws, wsMessageHandler, joiner.getSessionDetails(), this._serializer);
                        resolve(baseSession);
                    } else {
                        ws.send(toSend);
                    }
                } catch (error) {
                    reject(error);
                }
            };

            const closeHandler = () => {
                ws.removeEventListener('message', wsMessageHandler);
                reject(new Error('Connection closed before handshake completed'));
            };

            ws.addEventListener('message', wsMessageHandler);
            ws.addEventListener('error', (error) => reject(error));
            ws.addEventListener('close', closeHandler);
        });
    }
}
