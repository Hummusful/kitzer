import worker from './summary-worker.js';
import { withSummaryBurstLimit } from './summary-burst-limit.mjs';

export default withSummaryBurstLimit(worker);
