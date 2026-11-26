/** Worker thread: the Matribox NAM -> .clo conversion (generateMatriboxClo, ~35 s), progress as numbers, then the .clo. */
import { parentPort, workerData } from 'node:worker_threads';
import { encodeClo, generateMatriboxClo } from '@pocket-master/core';

const { namJson, di } = workerData as { namJson: string; di: Float32Array };
const clo = encodeClo(generateMatriboxClo(namJson, di, (fraction) => parentPort?.postMessage(fraction)));
parentPort?.postMessage(clo, [clo.buffer as ArrayBuffer]);
