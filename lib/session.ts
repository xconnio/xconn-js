import {
    WAMPSession,
    SessionScopeIDGenerator,
    Message,
    Call, CallFields,
    Result as ResultMsg,
    Error as ErrorMsg,
    Register, RegisterFields,
    Registered,
    Yield, YieldFields,
    Invocation as InvocationMsg
} from "wampproto";

import {wampErrorString} from "./helpers";
import {ApplicationError, ProtocolError} from "./exception";
import {IBaseSession, Result, Invocation, RegisterRequest, Registration} from "./types";


export class Session {
    private _baseSession: IBaseSession;
    private _wampSession: WAMPSession;
    private _idGen: SessionScopeIDGenerator = new SessionScopeIDGenerator();

    private _callRequests: Map<number, {
        resolve: (value: Result) => void,
        reject: (reason: ApplicationError) => void
    }> = new Map();
    private _registerRequests: Map<number, RegisterRequest> = new Map();
    private _registrations: Map<number, (invocation: Invocation) => Result> = new Map();

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

    private _processIncomingMessage(message: Message): void {
        if (message instanceof ResultMsg) {
            const promiseHandler = this._callRequests.get(message.requestID);
            promiseHandler.resolve(new Result(message.args, message.kwargs, message.options));
        } else if (message instanceof Registered) {
            const request = this._registerRequests.get(message.requestID);
            if (request) {
                this._registrations.set(message.registrationID, request.endpoint);
                request.promise.resolve(new Registration(message.registrationID));
                this._registerRequests.delete(message.requestID);
            }
        } else if (message instanceof InvocationMsg) {
            const endpoint = this._registrations.get(message.registrationID);
            if (endpoint) {
                const result = endpoint(new Invocation(message.args, message.kwargs, message.details));
                this._baseSession.send(this._wampSession.sendMessage(new Yield(
                    new YieldFields(message.requestID, result.args, result.kwargs, result.details)
                )));
            }
        } else if (message instanceof ErrorMsg) {
            switch (message.messageType) {
                case Call.TYPE: {
                    const promiseHandler = this._callRequests.get(message.requestID);
                    promiseHandler.reject(
                        new ApplicationError(message.uri, {args: message.args, kwargs: message.kwargs})
                    );

                    this._callRequests.delete(message.requestID);
                    break;
                }
                case Register.TYPE: {
                    const registerRequest = this._registerRequests.get(message.requestID);
                    registerRequest.promise.reject(
                        new ApplicationError(message.uri, {args: message.args, kwargs: message.kwargs})
                    );
                    this._registerRequests.delete(message.requestID);
                    break;
                }
                default:
                    throw new ProtocolError(wampErrorString(message));
            }
        } else {
            throw new ProtocolError(`Unexpected message type ${typeof message}`);
        }
    }

    async call(
        procedure: string,
        callOptions: {
            args?: any[] | null,
            kwargs?: { [key: string]: any } | null,
            options?: { [key: string]: any } | null
        } = {}
    ): Promise<Result> {
        const call = new Call(
            new CallFields(this._nextID, procedure, callOptions.args, callOptions.kwargs, callOptions.options)
        );

        let promiseHandler: {
            resolve: (value: Result | PromiseLike<Result>) => void;
            reject: (reason: ApplicationError) => void;
        };

        const promise = new Promise<Result>((resolve, reject) => {
            promiseHandler = {resolve, reject};
        });

        this._callRequests.set(call.requestID, promiseHandler);
        this._baseSession.send(this._wampSession.sendMessage(call));

        return promise;
    }

    async register(
        procedure: string,
        endpoint: (invocation: Invocation) => Result,
        options?: { [key: string]: any } | null
    ): Promise<Registration> {
        const register = new Register(new RegisterFields(this._nextID, procedure, options));
        let promiseHandler: {
            resolve: (value: Registration | PromiseLike<Registration>) => void;
            reject: (reason: ApplicationError) => void;
        };

        const promise = new Promise<Registration>((resolve, reject) => {
            promiseHandler = {resolve, reject};
        });

        const request = new RegisterRequest(promiseHandler, endpoint);
        this._registerRequests.set(register.requestID, request);
        this._baseSession.send(this._wampSession.sendMessage(register));
        return promise;
    }
}
