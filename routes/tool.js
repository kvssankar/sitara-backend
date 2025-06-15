import express from "express";
import {
  addToolToUser,
  getAllToolsFromUser,
  removeToolFromUser,
  updateToolOfUser,
} from "../utils/crud.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const tools = await getAllToolsFromUser(userId);
    res.status(200).json(tools);
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: e.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { tool } = req.body;
    const userId = req.userId;
    const result = await addToolToUser(userId, tool);
    res.status(200).json(result);
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: e.message });
  }
});

router.put("/", async (req, res) => {
  try {
    const { name, updatedTool } = req.body;
    const userId = req.userId;
    const result = await updateToolOfUser(userId, name, updatedTool);
    res.status(200).json(result);
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: e.message });
  }
});

router.delete("/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.userId;
    const result = await removeToolFromUser(userId, name);
    res.status(200).json(result);
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: e.message });
  }
});

export default router;
