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
    Invocation as InvocationMsg,
    Unregister, UnregisterFields,
    Unregistered,
    Publish, PublishFields,
    Published,
    Subscribe, SubscribeFields,
    Subscribed,
    Event as EventMsg,
    Unsubscribe, UnsubscribeFields,
    Unsubscribed
} from "wampproto";

import {wampErrorString} from "./helpers";
import {ApplicationError, ProtocolError} from "./exception";
import {
    IBaseSession,
    Result,
    Invocation,
    RegisterRequest,
    Registration,
    UnregisterRequest,
    Event,
    SubscribeRequest,
    Subscription,
    UnsubscribeRequest
} from "./types";


export class Session {
    private _baseSession: IBaseSession;
    private _wampSession: WAMPSession;
    private _idGen: SessionScopeIDGenerator = new SessionScopeIDGenerator();

    private _callRequests: Map<number, {
        resolve: (value: Result) => void,
        reject: (reason: ApplicationError) => void
    }> = new Map();
    private _registerRequests: Map<number, RegisterRequest> = new Map();
    private _registrations: Map<number, (invocation: Invocation) => Result | Promise<Result>> = new Map();
    private _unregisterRequests: Map<number, UnregisterRequest> = new Map();
    private _publishRequests: Map<number, {
        resolve: () => void,
        reject: (reason: ApplicationError) => void
    }> = new Map();
    private _subscribeRequests: Map<number, SubscribeRequest> = new Map();
    private _subscriptions: Map<number, (event: Event) => void> = new Map();
    private _unsubscribeRequests: Map<number, UnsubscribeRequest> = new Map();

    constructor(baseSession: IBaseSession) {
        this._baseSession = baseSession;
        this._wampSession = new WAMPSession(baseSession.serializer());

        (async () => {
            for (; ;) {
                const message = await this._baseSession.receive();
                await this._processIncomingMessage(this._wampSession.receive(message));
            }
        })();
    }

    private get _nextID(): number {
        return this._idGen.next();
    }

    async close(): Promise<void> {
        await this._baseSession.close();
    }

    private async _processIncomingMessage(message: Message): Promise<void> {
        if (message instanceof ResultMsg) {
            const promiseHandler = this._callRequests.get(message.requestID);
            promiseHandler.resolve(new Result(message.args, message.kwargs, message.options));
        } else if (message instanceof Registered) {
            const request = this._registerRequests.get(message.requestID);
            if (request) {
                this._registrations.set(message.registrationID, request.endpoint);
                request.promise.resolve(new Registration(message.registrationID, this));
                this._registerRequests.delete(message.requestID);
            }
        } else if (message instanceof InvocationMsg) {
            const endpoint = this._registrations.get(message.registrationID);
            if (endpoint) {
                const result = await endpoint(new Invocation(message.args, message.kwargs, message.details));
                this._baseSession.send(this._wampSession.sendMessage(new Yield(
                    new YieldFields(message.requestID, result.args, result.kwargs, result.details)
                )));
            }
        } else if (message instanceof Unregistered) {
            const request = this._unregisterRequests.get(message.requestID);
            if (request) {
                this._registrations.delete(request.registrationID);
                this._unregisterRequests.delete(message.requestID);
                request.promise.resolve();
            }
        } else if (message instanceof Published) {
            const request = this._publishRequests.get(message.requestID);
            if (request) {
                request.resolve();
                this._publishRequests.delete(message.requestID);
            }
        } else if (message instanceof Subscribed) {
            const request = this._subscribeRequests.get(message.requestID);
            if (request) {
                this._subscriptions.set(message.subscriptionID, request.endpoint);
                request.promise.resolve(new Subscription(message.subscriptionID));
                this._subscribeRequests.delete(message.requestID);
            }
        } else if (message instanceof EventMsg) {
            const endpoint = this._subscriptions.get(message.subscriptionID);
            if (endpoint) {
                endpoint(new Event(message.args, message.kwargs, message.details));
            }
        } else if (message instanceof Unsubscribed) {
            const request = this._unsubscribeRequests.get(message.requestID);
            if (request) {
                this._subscriptions.delete(request.subscriptionID);
                request.promise.resolve();
                this._unsubscribeRequests.delete(message.requestID);
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
                case Unregister.TYPE: {
                    const unregisterRequest = this._unregisterRequests.get(message.requestID);
                    unregisterRequest.promise.reject(
                        new ApplicationError(message.uri, {args: message.args, kwargs: message.kwargs})
                    );
                    this._unregisterRequests.delete(message.requestID);
                    break;
                }
                case Publish.TYPE: {
                    const publishRequest = this._publishRequests.get(message.requestID);
                    publishRequest.reject(
                        new ApplicationError(message.uri, {args: message.args, kwargs: message.kwargs})
                    );
                    this._publishRequests.delete(message.requestID);
                    break;
                }
                case Subscribe.TYPE: {
                    const subscribeRequest = this._subscribeRequests.get(message.requestID);
                    if (subscribeRequest) {
                        subscribeRequest.promise.reject(
                            new ApplicationError(message.uri, {args: message.args, kwargs: message.kwargs})
                        )
                        this._subscribeRequests.delete(message.requestID);
                    }
                    break;
                }
                case Unsubscribe.TYPE: {
                    const unsubscribeRequest = this._unsubscribeRequests.get(message.requestID);
                    if (unsubscribeRequest) {
                        unsubscribeRequest.promise.reject(
                            new ApplicationError(message.uri, {args: message.args, kwargs: message.kwargs})
                        )
                        this._unsubscribeRequests.delete(message.requestID);
                    }
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
        endpoint: (invocation: Invocation) => Result | Promise<Result>,
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

    async unregister(reg: Registration): Promise<void> {
        const unregister = new Unregister(new UnregisterFields(this._nextID, reg.registrationID));
        let promiseHandler: {
            resolve: () => void;
            reject: (reason: ApplicationError) => void
        };

        const promise = new Promise<void>((resolve, reject) => {
            promiseHandler = {resolve, reject};
        });

        const request = new UnregisterRequest(promiseHandler, reg.registrationID);
        this._unregisterRequests.set(unregister.requestID, request);
        this._baseSession.send(this._wampSession.sendMessage(unregister));

        return promise;
    }

    async publish(
        topic: string,
        publishOptions: {
            args?: any[] | null,
            kwargs?: { [key: string]: any } | null,
            options?: { [key: string]: any } | null
        } = {}
    ): Promise<void | null> {
        const publish = new Publish(new PublishFields(
            this._nextID, topic, publishOptions.args, publishOptions.kwargs, publishOptions.options)
        );

        this._baseSession.send(this._wampSession.sendMessage(publish));
        if (publishOptions.options?.["acknowledge"]) {
            let promiseHandler: { resolve: () => void; reject: (reason: ApplicationError) => void; };
            const promise = new Promise<void>((resolve, reject) => {
                promiseHandler = {resolve, reject};
            });
            this._publishRequests.set(publish.requestID, promiseHandler);

            return promise;
        }

        return null;
    }

    async subscribe(
        topic: string,
        endpoint: (event: Event) => void,
        options?: { [key: string]: any } | null
    ): Promise<Subscription> {
        const subscribe = new Subscribe(new SubscribeFields(this._nextID, topic, options));

        let promiseHandler: {
            resolve: (value: Subscription | PromiseLike<Subscription>) => void;
            reject: (reason: ApplicationError) => void;
        };

        const promise = new Promise<Subscription>((resolve, reject) => {
            promiseHandler = {resolve, reject};
        });

        const request = new SubscribeRequest(promiseHandler, endpoint);
        this._subscribeRequests.set(subscribe.requestID, request);
        this._baseSession.send(this._wampSession.sendMessage(subscribe));

        return promise;
    }

    async unsubscribe(sub: Subscription): Promise<void> {
        const unsubscribe = new Unsubscribe(new UnsubscribeFields(this._nextID, sub.subscriptionID));
        let promiseHandler: {
            resolve: () => void;
            reject: (reason: ApplicationError) => void
        };

        const promise = new Promise<void>((resolve, reject) => {
            promiseHandler = {resolve, reject};
        });
        const request = new UnsubscribeRequest(promiseHandler, sub.subscriptionID);
        this._unsubscribeRequests.set(unsubscribe.requestID, request);
        this._baseSession.send(this._wampSession.sendMessage(unsubscribe));

        return promise;
    }
}
