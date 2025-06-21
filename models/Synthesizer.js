import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import sessionManager from "./SessionManager.js";
import { SessionDataProperty } from "../utils/index.js";
import WebSocket from "ws";
import alawmulaw from "alawmulaw";
const { mulaw } = alawmulaw;

const pollyClient = new PollyClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const activeVoiceResponses = new Map();

async function convertTextToSpeechStream(sessionId, text) {
  console.log(`Converting text to speech for session ${sessionId}: ${text}`);

  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: "pcm",
      VoiceId: "Joanna",
      Engine: "neural",
      SampleRate: "8000", // 8kHz for Twilio
      TextType: "text",
    });

    const response = await pollyClient.send(command);

    if (!response.AudioStream) {
      throw new Error("No audio stream received from Polly");
    }

    const audioBuffer = await streamToBuffer(response.AudioStream);

    // Convert PCM (Int16LE) to μ-law using alawmulaw
    const pcmSamples = new Int16Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.length / 2
    );
    const muLawSamples = mulaw.encode(pcmSamples);
    const mulawBuffer = Buffer.from(muLawSamples.buffer);

    const audioOutput = mulawBuffer.toString("base64");

    const ws = sessionManager.getProperty(sessionId, SessionDataProperty.ws);
    const streamSid = sessionManager.getProperty(
      sessionId,
      SessionDataProperty.streamSid
    );

    if (!ws || !streamSid) {
      console.error("WebSocket or StreamSid not found for session:", sessionId);
      return "";
    }

    const mediaMessage = {
      event: "media",
      streamSid: streamSid,
      media: {
        payload: audioOutput,
      },
    };

    console.log(
      `WebSocket ready state: ${ws.readyState}, OPEN: ${WebSocket.OPEN}`
    );

    if (ws.readyState === WebSocket.OPEN) {
      activeVoiceResponses.set(sessionId, {
        timestamp: Date.now(),
        text: text,
      });

      ws.send(JSON.stringify(mediaMessage));
      console.log(`Voice response sent for session ${sessionId}`);

      setTimeout(() => {
        activeVoiceResponses.delete(sessionId);
      }, estimateAudioDuration(text) * 1000 + 1000);
    } else {
      console.error(
        `WebSocket not ready for session ${sessionId}. ReadyState: ${ws.readyState}`
      );
    }

    return JSON.stringify(mediaMessage);
  } catch (error) {
    console.error("Error in text to speech conversion:", error);
    return "";
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];

  if (stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// Estimate audio duration based on text length
function estimateAudioDuration(text) {
  const wordsPerMinute = 150;
  const avgWordLength = 5;
  const estimatedWords = text.length / avgWordLength;
  const durationMinutes = estimatedWords / wordsPerMinute;
  return durationMinutes * 60;
}

// Stop/interrupt current voice response
function stopVoiceResponse(sessionId) {
  console.log(`Stopping voice response for session ${sessionId}`);

  const ws = sessionManager.getProperty(sessionId, SessionDataProperty.ws);
  const streamSid = sessionManager.getProperty(
    sessionId,
    SessionDataProperty.streamSid
  );

  if (ws && ws.readyState === WebSocket.OPEN && streamSid) {
    const clearMessage = {
      event: "clear",
      streamSid: streamSid,
    };

    ws.send(JSON.stringify(clearMessage));
    console.log(`Clear message sent for session ${sessionId}`);
  }

  activeVoiceResponses.delete(sessionId);
}

// Check if there's an active voice response
function hasActiveVoiceResponse(sessionId) {
  return activeVoiceResponses.has(sessionId);
}

// Get available Polly voices
async function getAvailableVoices() {
  try {
    const { ListVoicesCommand } = await import("@aws-sdk/client-polly");
    const command = new ListVoicesCommand({
      LanguageCode: "en-US",
      Engine: "neural",
    });

    const response = await pollyClient.send(command);
    return response.Voices || [];
  } catch (error) {
    console.error("Error fetching available voices:", error);
    return [];
  }
}

// Wrapper function to retry with fallback engine
async function convertTextToSpeechWithVoice(
  sessionId,
  text,
  voiceId = "Joanna",
  engine = "neural"
) {
  try {
    return await convertTextToSpeechStream(sessionId, text);
  } catch (error) {
    console.error(`Error with voice ${voiceId}:`, error);

    if (engine === "neural") {
      console.log("Falling back to standard engine...");
      return await convertTextToSpeechWithVoice(
        sessionId,
        text,
        voiceId,
        "standard"
      );
    }

    throw error;
  }
}

export {
  convertTextToSpeechStream,
  stopVoiceResponse,
  hasActiveVoiceResponse,
  getAvailableVoices,
  convertTextToSpeechWithVoice,
};
