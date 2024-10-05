import {WAMPSession,SessionScopeIDGenerator,Message} from "wampproto";

import {IBaseSession} from "./types";


export class Session {
    private _baseSession: IBaseSession;
    private _wampSession: WAMPSession;
    private _idGen: SessionScopeIDGenerator = new SessionScopeIDGenerator();

    constructor(baseSession: IBaseSession) {
        this._baseSession = baseSession;
        this._wampSession = new WAMPSession(baseSession.serializer());

        (async () => {
            for (; ;) {
                const message = await this._baseSession.receive();
                this._processIncomingMessage(this._wampSession.receive(message));
            }
        })();
    }

    private get _nextID(): number {
        return this._idGen.next();
    }

    async close(): Promise<void> {
        await this._baseSession.close();
    }

    private _processIncomingMessage(message: Message): void {}
}
