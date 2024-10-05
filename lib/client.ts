import {ClientAuthenticator, Serializer} from "wampproto";

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

    async connect(url: string, realm: string): Promise<Session> {
        const joiner = new WAMPSessionJoiner({authenticator: this._authenticator, serializer: this._serializer});
        const baseSession: BaseSession = await joiner.join(url, realm);
        return new Session(baseSession);
    }
}
