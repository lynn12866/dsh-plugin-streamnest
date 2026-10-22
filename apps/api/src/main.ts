import { resolve } from 'node:path';
import { createApplication } from './create-application.js';
import { API_PREFIX } from '../../shared/src/contracts.js';

const { app } = await createApplication(resolve(process.env.STREAMNEST_DATA_DIR ?? '.data'), true);
const port = Number(process.env.STREAMNEST_PORT ?? 4322);

app.enableShutdownHooks();
await app.listen(port, '127.0.0.1');
console.log(`拾流 API：http://127.0.0.1:${port}${API_PREFIX}`);
