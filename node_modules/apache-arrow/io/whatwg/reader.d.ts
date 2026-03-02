/// <reference types="node" />
import { TypeMap } from '../../type.js';
import { RecordBatch } from '../../recordbatch.js';
/** @ignore */
export declare function recordBatchReaderThroughDOMStream<T extends TypeMap = any>(writableStrategy?: ByteLengthQueuingStrategy, readableStrategy?: {
    autoDestroy: boolean;
}): {
    writable: import("stream/web").WritableStream<ArrayBufferView>;
    readable: import("stream/web").ReadableStream<RecordBatch<T>>;
};
