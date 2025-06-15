// server.js
import express from "express";
import intentRoutes from "./routes/intent.js";
// import genaiRoutes from "./routes/genai.js";
import ragRoutes from "./routes/rag.js";
import toolRoutes from "./routes/tool.js";
import chatRoutes from "./routes/chat.js";
import serverlessExpress from "@vendia/serverless-express";
import cors from "cors";
const app = express();

app.use(cors());

app.get("/health", (req, res) => {
  res.status(200).json({ message: "Server is running" });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  req.userId = req.headers.authorization;
  next();
});

// Routes
app.use("/intents", intentRoutes);
// app.use("/genai", genaiRoutes);
app.use("/rag", ragRoutes);
app.use("/tools", toolRoutes);
app.use("/chat", chatRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
//   console.log(process.env);
// });

const server = serverlessExpress({ app });

export const handler = (event, context) => server(event, context);
