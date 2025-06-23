// routes/support.js

import express from "express";
import {
  createSupportCase,
  getSupportCase,
  updateSupportCase,
  getSupportCases,
  deleteSupportCase,
  addMessageToCase,
  getCaseMessages,
  addInternalNote,
} from "../utils/supportCrud.js";
import { getPresignedUploadUrl } from "../utils/supportFiles.js";
import SupportAgent from "../models/SupportAgent.js";

const router = express.Router();
const supportAgent = new SupportAgent();

// Support Case Routes
router.post("/cases", async (req, res) => {
  try {
    const { customerId, title, description, priority } = req.body;

    if (!customerId || !title) {
      return res.status(400).json({
        error: "customerId and title are required",
      });
    }

    const supportCase = await createSupportCase(
      customerId,
      title,
      description,
      priority
    );

    setTimeout(() => {
      supportAgent.processNewTicket(supportCase.caseId);
    }, 15000);

    res.status(201).json(supportCase);
  } catch (error) {
    console.error("Error creating support case:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/cases/:caseId", async (req, res) => {
  try {
    const supportCase = await getSupportCase(req.params.caseId);
    res.json(supportCase);
  } catch (error) {
    console.error("Error fetching support case:", error);
    res.status(404).json({ error: error.message });
  }
});

router.put("/cases/:caseId", async (req, res) => {
  try {
    const updates = req.body;
    const supportCase = await updateSupportCase(req.params.caseId, updates);
    res.json(supportCase);
  } catch (error) {
    console.error("Error updating support case:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/cases", async (req, res) => {
  try {
    const filters = {
      customerId: req.query.customerId,
      status: req.query.status,
      assignedAgent: req.query.assignedAgent,
      priority: req.query.priority,
      limit: parseInt(req.query.limit) || 50,
    };

    const cases = await getSupportCases(filters);
    res.json(cases);
  } catch (error) {
    console.error("Error fetching support cases:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/cases/:caseId", async (req, res) => {
  try {
    await deleteSupportCase(req.params.caseId);
    res.json({ message: "Support case deleted successfully" });
  } catch (error) {
    console.error("Error deleting support case:", error);
    res.status(500).json({ error: error.message });
  }
});

// Message Routes
router.post("/cases/:caseId/messages", async (req, res) => {
  try {
    const { caseId } = req.params;
    const { senderId, senderType, content, messageType, mediaUrls } = req.body;

    if (!senderId || !senderType || !content) {
      return res.status(400).json({
        error: "senderId, senderType, and content are required",
      });
    }

    const message = await addMessageToCase(
      caseId,
      senderId,
      senderType,
      content,
      messageType || "text",
      mediaUrls || []
    );

    res.status(201).json(message);
  } catch (error) {
    console.error("Error adding message:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/cases/:caseId/messages", async (req, res) => {
  try {
    const { caseId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const messages = await getCaseMessages(caseId, limit);
    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/cases/:caseId/notes", async (req, res) => {
  try {
    const { caseId } = req.params;
    const { agentId, content } = req.body;

    if (!agentId || !content) {
      return res.status(400).json({
        error: "agentId and content are required",
      });
    }

    const note = await addInternalNote(caseId, agentId, content);
    res.status(201).json(note);
  } catch (error) {
    console.error("Error adding internal note:", error);
    res.status(500).json({ error: error.message });
  }
});

// File Upload Routes
router.post("/cases/:caseId/upload-url", async (req, res) => {
  try {
    const { caseId } = req.params;
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({
        error: "fileName and fileType are required",
      });
    }

    const uploadInfo = await getPresignedUploadUrl(caseId, fileName, fileType);
    res.json(uploadInfo);
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: error.message });
  }
});

// Case Summary Routes
router.get("/cases/:caseId/summary", async (req, res) => {
  try {
    const { caseId } = req.params;
    const forceRegenerate = req.query.force === "true";

    const result = await supportAgent.getCaseSummary(caseId, forceRegenerate);

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error("Error getting case summary:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/cases/:caseId/summary", async (req, res) => {
  try {
    const { caseId } = req.params;

    const result = await supportAgent.generateCaseSummary(caseId);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error("Error generating case summary:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
