import express from "express";
import {
  getIntents,
  getIntent,
  createIntent,
  deleteIntent,
  updateIntent,
} from "../utils/crud.js";
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const intents = await getIntents(req.userId);
    res.status(200).json(intents);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

router.get("/:intentid", async (req, res) => {
  try {
    const userId = req.userId;
    const intent = await getIntent(req.params.intentid, userId);
    res.status(200).json(intent);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    await createIntent(req.body, req.userId);
    res.status(200).json({ message: "Intent created" });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

router.put("/:intentid", async (req, res) => {
  try {
    await updateIntent(req.params.intentid, req.body, req.userId);
    res.status(200).json({ message: "Intent updated" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:intentid", async (req, res) => {
  try {
    await deleteIntent(req.params.intentid);
    res.status(200).json({ message: "Intent deleted" });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

export default router;
