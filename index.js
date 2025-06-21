// server.js
import express from "express";
import intentRoutes from "./routes/intent.js";
// import genaiRoutes from "./routes/genai.js";
import ragRoutes from "./routes/rag.js";
import toolRoutes from "./routes/tool.js";
import chatRoutes from "./routes/chat.js";
import serverlessExpress from "@vendia/serverless-express";
import cors from "cors";
import { WebSocketServer } from "ws";
import AmazonTranscriber from "./models/Transcriber.js";
import sessionManager from "./models/SessionManager.js";
import { SessionDataProperty } from "./utils/index.js";
import http from "http";
const app = express();

app.use(cors());

app.get("/health", (req, res) => {
  res.status(200).json({ message: "Server is running" });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", function connection(ws) {
  let transcriber = new AmazonTranscriber();
  ws.on("message", function incoming(message) {
    try {
      const msg = JSON.parse(message);
      switch (msg.event) {
        case "connected":
          break;
        case "start":
          const callSid = msg["start"]["callSid"];
          const streamSid = msg["start"]["streamSid"];

          console.log(
            `Call started - CallSid: ${callSid}, StreamSid: ${streamSid}`
          );

          // Store WebSocket and stream information
          sessionManager.setProperty(callSid, SessionDataProperty.ws, ws);
          sessionManager.setProperty(
            callSid,
            SessionDataProperty.streamSid,
            streamSid
          );

          transcriber.connect(callSid);
          break;
        case "media":
          if (transcriber.isConnected) {
            transcriber.processVoice(msg.media.payload);
          }
          break;
        case "stop":
          transcriber.close();
          break;
      }
    } catch (error) {
      console.error("WebSocket message processing error:", error);
    }
  });
});

app.post("/", async (req, res) => {
  console.log("Incoming call:", req.body);
  await sessionManager.getSession(req.body.CallSid);
  // logger.info({
  //   type: "twilio",
  //   sub_type: "incoming-call",
  //   //@ts-ignore
  //   session_id: req.body.CallSid
  // })
  // console.log(req.body,req.headers)
  sessionManager.setSessionVariable(
    req.body.CallSid,
    "phone_number",
    req.body.From
  );
  res.set("Content-Type", "text/xml");
  console.log(req.headers.host);
  res.send(`
    <Response>
      <Connect>
        <Stream url="wss://${req.headers.host}/"/>
      </Connect>
    </Response>
  `);
});

app.use((req, res, next) => {
  // if (!req.headers.authorization) {
  //   return res.status(401).json({ message: "Unauthorized" });
  // }
  req.userId = "684d43c3234f6819aae4d80e";
  next();
});

// Routes
app.use("/intents", intentRoutes);
// app.use("/genai", genaiRoutes);
app.use("/rag", ragRoutes);
app.use("/tools", toolRoutes);
app.use("/chat", chatRoutes);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});
//set 5mins
server.setTimeout(300000);

// const server = serverlessExpress({ app });

// export const handler = (event, context) => server(event, context);
