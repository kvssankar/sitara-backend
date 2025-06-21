// OutputCapture.js
import { ProceedStatus } from "../utils/index.js";

export class OutputCapture {
  constructor(options) {
    this.proceed = options.proceed;
    this.sessionId = options.sessionId;
    this.data = options.data;
    this.metadata = options.metadata;
  }
}
