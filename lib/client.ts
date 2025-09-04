import {
    CBORSerializer,
    ClientAuthenticator,
    CryptoSignAuthenticator,
    Serializer,
    TicketAuthenticator,
    WAMPCRAAuthenticator,
} from "wampproto";

import {Session} from "./session";
import {BaseSession} from "./types";
import {WAMPSessionJoiner} from "./joiner";


export class Client {
    private readonly _authenticator?: ClientAuthenticator;
    private readonly _serializer?: Serializer;

    constructor(clientOptions: { authenticator?: ClientAuthenticator; serializer?: Serializer } = {}) {
        this._authenticator = clientOptions.authenticator;
        this._serializer = clientOptions.serializer;
    }

    async connect(uri: string, realm: string): Promise<Session> {
        return connect(uri, realm, {authenticator: this._authenticator, serializer: this._serializer});
    }
}

export async function connect(
    uri: string,
    realm: string,
    clientOptions: { authenticator?: ClientAuthenticator; serializer?: Serializer } = {}
): Promise<Session> {
    const serializer = clientOptions.serializer ?? new CBORSerializer();
    const joiner = new WAMPSessionJoiner({authenticator: clientOptions.authenticator, serializer: serializer});
    const baseSession: BaseSession = await joiner.join(uri, realm);

    return new Session(baseSession);
}

export async function connectAnonymous(uri: string, realm: string): Promise<Session> {
    return connect(uri, realm);
}

export async function connectTicket(uri: string, realm: string, authid: string, ticket: string): Promise<Session> {
    const ticketAuthenticator = new TicketAuthenticator(authid, ticket, null)

    return connect(uri, realm, {authenticator: ticketAuthenticator});
}

export async function connectCRA(uri: string, realm: string, authid: string, secret: string): Promise<Session> {
    const craAuthenticator = new WAMPCRAAuthenticator(authid, secret, null)

    return connect(uri, realm, {authenticator: craAuthenticator});
}

export async function connectCryptosign(uri: string, realm: string, authid: string, privateKey: string): Promise<Session> {
    const cryptosignAuthenticator = new CryptoSignAuthenticator(authid, privateKey, {})

    return connect(uri, realm, {authenticator: cryptosignAuthenticator});
}
