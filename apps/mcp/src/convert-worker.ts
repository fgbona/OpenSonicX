/** Worker thread: one probe pass of the NAM -> clone conversion (the slow part). */
import { parentPort, workerData } from 'node:worker_threads';
import { parseNam, probeResponse } from '@pocket-master/core';

const { namJson, di48, level } = workerData as { namJson: string; di48: Float64Array; level: number };
const response = probeResponse(parseNam(namJson), di48, level);
parentPort?.postMessage(response, [response.buffer as ArrayBuffer]);
