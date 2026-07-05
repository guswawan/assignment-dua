import { Queue } from "bullmq";
import { connection, PRD_QUEUE_NAME } from "./queue-config.js";

export const prdQueue = new Queue(PRD_QUEUE_NAME, { connection });
