// utils/TTV.js
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import sessionManager from "./SessionManager.js";
import { SessionDataProperty } from "../utils/index.js";
import WebSocket from "ws";

const pollyClient = new PollyClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Map to track active voice responses for interruption
const activeVoiceResponses = new Map();

async function convertTextToSpeechStream(sessionId, text) {
  console.log(`Converting text to speech for session ${sessionId}: ${text}`);

  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: "pcm", // Raw PCM format
      VoiceId: "Joanna", // You can change this to other voices like "Matthew", "Amy", etc.
      Engine: "neural", // Use neural engine for better quality
      SampleRate: "8000", // 8kHz for Twilio
      TextType: "text",
    });

    const response = await pollyClient.send(command);

    if (!response.AudioStream) {
      throw new Error("No audio stream received from Polly");
    }

    // Convert the audio stream to buffer
    const audioBuffer = await streamToBuffer(response.AudioStream);

    // Convert PCM to μ-law for Twilio
    const mulawBuffer = convertPCMToMulaw(audioBuffer);

    // Convert to base64 for Twilio media message
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
      // Store this voice response for potential interruption
      activeVoiceResponses.set(sessionId, {
        timestamp: Date.now(),
        text: text,
      });

      ws.send(JSON.stringify(mediaMessage));
      console.log(`Voice response sent for session ${sessionId}`);

      // Clean up after a delay (assuming the audio finished playing)
      setTimeout(() => {
        activeVoiceResponses.delete(sessionId);
      }, estimateAudioDuration(text) * 1000 + 1000); // Add 1 second buffer
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

  // Handle readable stream
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// Convert PCM to μ-law
function convertPCMToMulaw(pcmBuffer) {
  const mulawBuffer = Buffer.alloc(pcmBuffer.length / 2);

  for (let i = 0; i < pcmBuffer.length; i += 2) {
    const pcmSample = pcmBuffer.readInt16LE(i);
    const mulawSample = pcmToMulaw(pcmSample);
    mulawBuffer[i / 2] = mulawSample;
  }

  return mulawBuffer;
}

// PCM to μ-law conversion algorithm
function pcmToMulaw(pcmSample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  const MULAW_MAX = 0x1fff;

  // Get the sign and magnitude
  const sign = pcmSample < 0 ? 0x80 : 0x00;
  let magnitude = Math.abs(pcmSample);

  // Clip the magnitude
  if (magnitude > CLIP) magnitude = CLIP;

  // Add bias
  magnitude += BIAS;

  // Find the exponent
  let exponent = 7;
  for (let exp = 0; exp < 8; exp++) {
    if (magnitude <= 0x1f << (exp + 3)) {
      exponent = exp;
      break;
    }
  }

  // Find the mantissa
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;

  // Create the μ-law byte
  const mulawByte = ~(sign | (exponent << 4) | mantissa);

  return mulawByte & 0xff;
}

// Estimate audio duration based on text length (rough approximation)
function estimateAudioDuration(text) {
  // Average speaking rate is about 150-160 words per minute
  // Average word length is about 5 characters
  const wordsPerMinute = 150;
  const avgWordLength = 5;
  const estimatedWords = text.length / avgWordLength;
  const durationMinutes = estimatedWords / wordsPerMinute;
  return durationMinutes * 60; // Convert to seconds
}

// Function to stop/interrupt current voice response
function stopVoiceResponse(sessionId) {
  console.log(`Stopping voice response for session ${sessionId}`);

  const ws = sessionManager.getProperty(sessionId, SessionDataProperty.ws);
  const streamSid = sessionManager.getProperty(
    sessionId,
    SessionDataProperty.streamSid
  );

  if (ws && ws.readyState === WebSocket.OPEN && streamSid) {
    // Send a "clear" message to stop current audio
    const clearMessage = {
      event: "clear",
      streamSid: streamSid,
    };

    ws.send(JSON.stringify(clearMessage));
    console.log(`Clear message sent for session ${sessionId}`);
  }

  // Remove from active responses
  activeVoiceResponses.delete(sessionId);
}

// Check if there's an active voice response
function hasActiveVoiceResponse(sessionId) {
  return activeVoiceResponses.has(sessionId);
}

// Get available Polly voices (utility function)
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

// Alternative implementation with different voice options
async function convertTextToSpeechWithVoice(
  sessionId,
  text,
  voiceId = "Joanna",
  engine = "neural"
) {
  const originalVoice = voiceId;

  try {
    return await convertTextToSpeechStream(sessionId, text);
  } catch (error) {
    console.error(`Error with voice ${originalVoice}:`, error);

    // Fallback to standard engine if neural fails
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
