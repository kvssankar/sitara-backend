import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";
import { RunType, SessionDataProperty } from "../utils/index.js";
import sessionManager from "./SessionManager.js";
import { stopVoiceResponse } from "./Synthesizer.js";

export default class AmazonTranscriber {
  keepAlive = true;
  callSid = "";
  isConnected = false;
  isStreaming = false; // Add this separate flag
  transcriber = null;
  options = null;
  streamController = null;
  audioBuffer = [];

  constructor() {
    this.options = {
      LanguageCode: "en-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 8000,
    };

    this.streamController = new AbortController();
    this.transcriber = new TranscribeStreamingClient();
  }

  connect(callSid) {
    this.callSid = callSid;
    this.startTranscription();
  }

  async startTranscription() {
    try {
      this.isStreaming = true; // Set streaming flag first

      this.command = new StartStreamTranscriptionCommand({
        ...this.options,
        AudioStream: this.getAudioStream(),
      });

      console.log("Sending transcription command...");
      const response = await this.transcriber.send(this.command);
      this.isConnected = true;
      console.log("Amazon Transcribe: connected and streaming started");

      this.processTranscriptionResults(response);
    } catch (error) {
      console.error("Amazon Transcribe: connection error", error);
      this.isConnected = false;
      this.isStreaming = false;
    }
  }

  async *getAudioStream() {
    console.log("Audio stream generator started, waiting for audio...");

    while (this.isStreaming && !this.streamController.signal.aborted) {
      if (this.audioBuffer.length > 0) {
        const chunk = this.audioBuffer.shift();
        if (chunk && chunk.length > 0) {
          const pcmChunk = this.convertMulawToPCM(chunk);
          //   console.log(`Yielding audio chunk: ${pcmChunk.length} bytes`);

          yield {
            AudioEvent: {
              AudioChunk: pcmChunk,
            },
          };
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    console.log("Audio stream generator ended");
  }

  convertMulawToPCM(mulawBuffer) {
    // Convert μ-law to PCM 16-bit
    const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);

    for (let i = 0; i < mulawBuffer.length; i++) {
      const mulawByte = mulawBuffer[i];
      const pcmValue = this.mulawToPCM(mulawByte);
      pcmBuffer.writeInt16LE(pcmValue, i * 2);
    }

    return pcmBuffer;
  }

  mulawToPCM(mulawByte) {
    // μ-law decompression algorithm
    const BIAS = 0x84;
    const CLIP = 32635;

    mulawByte = ~mulawByte;
    const sign = mulawByte & 0x80 ? -1 : 1;
    const exponent = (mulawByte >> 4) & 0x07;
    const mantissa = mulawByte & 0x0f;

    let sample = mantissa << (exponent + 3);
    sample += BIAS;
    if (exponent === 0) sample += 0x20;

    return sign * Math.min(sample, CLIP);
  }

  async processTranscriptionResults(response) {
    try {
      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (event.TranscriptEvent) {
            const results = event.TranscriptEvent.Transcript?.Results;
            if (results && results.length > 0) {
              const result = results[0];
              const transcript = result.Alternatives?.[0]?.Transcript;

              if (transcript && transcript.length > 0) {
                console.log(
                  `Amazon Transcribe: ${
                    result.IsPartial ? "Partial" : "Final"
                  } - ${transcript}`
                );

                if (result.IsPartial) {
                  // Handle partial transcripts - stop current voice response
                  if (
                    !sessionManager.getProperty(
                      this.callSid,
                      SessionDataProperty.apiProcessing
                    ) &&
                    !sessionManager.getProperty(
                      this.callSid,
                      SessionDataProperty.outputBlockProcessing
                    ) &&
                    !sessionManager.getProperty(
                      this.callSid,
                      SessionDataProperty.agentLoopProcessing
                    )
                  ) {
                    sessionManager.setProperty(
                      this.callSid,
                      SessionDataProperty.humanSpeaking,
                      true
                    );
                    console.log(
                      "Amazon Transcribe Partial script:",
                      transcript
                    );
                    stopVoiceResponse(this.callSid);
                  } else {
                    console.log(
                      "Amazon Transcribe Partial ignored script:",
                      transcript
                    );
                  }
                } else {
                  // Handle final transcripts
                  console.log("Amazon Transcribe Final script:", transcript);
                  const status = await processData(transcript, this.callSid);
                  if (status === "transferred") {
                    logger.info({
                      type: "transfer",
                      session_id: this.callSid,
                      message:
                        "Amazon Transcribe closed as the call got transferred",
                    });
                    this.close();
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Amazon Transcribe: error processing results", error);
    }
  }

  processVoice(twilioData) {
    if (this.isConnected && twilioData) {
      try {
        const audioBuffer = Buffer.from(twilioData, "base64");
        this.audioBuffer.push(audioBuffer);
        // console.log(
        //   `Audio buffered: ${audioBuffer.length} bytes, total buffer: ${this.audioBuffer.length} chunks`
        // );
      } catch (error) {
        console.error("Error processing voice data:", error);
      }
    } else {
      console.log("Not connected or no audio data");
    }
  }

  close() {
    console.log("Amazon Transcribe: disconnecting");
    this.isConnected = false;
    this.isStreaming = false; // Stop streaming
    this.audioBuffer = [];
    this.streamController.abort();
  }
}

async function processData(transcript, callSid) {
  if (
    !sessionManager.getProperty(callSid, SessionDataProperty.apiProcessing) &&
    !sessionManager.getProperty(
      callSid,
      SessionDataProperty.outputBlockProcessing
    ) &&
    !sessionManager.getProperty(
      callSid,
      SessionDataProperty.agentLoopProcessing
    )
  ) {
    try {
      const session = sessionManager.sessions[callSid];
      const userId = session?.userId || "684d43c3234f6819aae4d80e";

      await sessionManager.run({
        session_id: callSid,
        text: transcript,
        type: RunType.AI,
        isChat: false,
        userId: userId,
      });
    } catch (error) {
      console.error("Error processing data:", error);
    }
  }
}
