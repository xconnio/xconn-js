export class ApplicationError extends Error {
    public readonly message: string;
    public readonly args?: any[];
    public readonly kwargs?: { [key: string]: any } | null;

    constructor(message: string, options?: { args?: any[]; kwargs?: { [key: string]: any } | null }) {
        super(message);
        this.message = message;
        this.args = options?.args;
        this.kwargs = options?.kwargs;
    }

    toString(): string {
        let errStr = this.message;

        if (this.args && this.args.length > 0) {
            const argsStr = this.args.map(arg => arg.toString()).join(", ");
            errStr += `: ${argsStr}`;
        }

        if (this.kwargs && Object.keys(this.kwargs).length > 0) {
            const kwargsStr = Object.entries(this.kwargs)
                .map(([key, value]) => `${key}=${value}`)
                .join(", ");
            errStr += `: ${kwargsStr}`;
        }

        return errStr;
    }
}

export class ProtocolError extends Error {
    constructor(public readonly message: string) {
        super(message);
        this.message = message;
    }
}
