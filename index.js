// server.js
import express from "express";
import intentRoutes from "./routes/intent.js";
import ragRoutes from "./routes/rag.js";
import toolRoutes from "./routes/tool.js";
import serverlessExpress from "@vendia/serverless-express";
import cors from "cors";
import supportRoutes from "./routes/support.js";

const app = express();

app.use(cors());

app.get("/health", (req, res) => {
  res.status(200).json({ message: "Server is running" });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  // if (!req.headers.authorization) {
  //   return res.status(401).json({ message: "Unauthorized" });
  // }
  req.userId = "684d43c3234f6819aae4d80e";
  next();
});

// Routes
app.use("/intents", intentRoutes);
app.use("/rag", ragRoutes);
app.use("/tools", toolRoutes);
app.use("/support", supportRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});

// const server = serverlessExpress({ app });

// export const handler = (event, context) => server(event, context);
